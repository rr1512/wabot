require('dotenv').config();
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
} = require('@whiskeysockets/baileys');
const express = require('express');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const sharp = require('sharp');
const rimraf = require('rimraf');
const { createClient } = require('@supabase/supabase-js');
const webpush = require('web-push');
const app = express();
const port = process.env.PORT || 3001;
const basicAuth = require('express-basic-auth');
const multer = require('multer');
const upload = multer({ dest: 'tmp/' });
app.use(express.json());
app.use('/media', express.static(path.join(__dirname, 'tmp')));
app.use(express.static(path.join(__dirname, 'public')));

// Create necessary directories
const dataDir = path.join(__dirname, 'data');
const chatDir = path.join(dataDir, 'chats');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
if (!fs.existsSync(chatDir)) {
  fs.mkdirSync(chatDir, { recursive: true });
}

let connectionStatus = 'disconnected';
let latestQR = null;
let sock;
let connectedNumber = null;
const sentByAI = new Set();

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

// Store recently saved messages to prevent duplicates
const recentlySavedMessages = new Map();

// Chat history storage functions
function saveChatToFile(remoteJid, message, isFromMe = false, pushname = null) {
  try {
    // Clean jid to use as filename (remove @s.whatsapp.net)
    const cleanJid = remoteJid.replace(/@.+/, '');
    const chatDir = path.join(__dirname, 'data', 'chats');
    const chatFile = path.join(chatDir, `${cleanJid}.json`);
    
    // Create directory if it doesn't exist
    if (!fs.existsSync(chatDir)) {
      fs.mkdirSync(chatDir, { recursive: true });
    }
    
    // Generate a unique key for deduplication
    const messageText = message.text || message.caption || '[Media Message]';
    const dedupeKey = `${remoteJid}|${messageText}|${isFromMe}|${Date.now()}`;
    
    // Check if this message was recently saved (within last 2 seconds)
    const now = Date.now();
    for (const [key, timestamp] of recentlySavedMessages.entries()) {
      // Remove entries older than 2 seconds
      if (now - timestamp > 2000) {
        recentlySavedMessages.delete(key);
      }
    }
    
    // If message content is similar to a recently saved one, skip it
    for (const key of recentlySavedMessages.keys()) {
      const [storedJid, storedText, storedDirection] = key.split('|');
      if (storedJid === remoteJid && 
          storedText === messageText && 
          storedDirection === String(isFromMe)) {
        console.log('Skipping duplicate message:', messageText);
        return false;
      }
    }
    
    // Mark this message as recently saved
    recentlySavedMessages.set(`${remoteJid}|${messageText}|${isFromMe}`, now);
    
    // Load existing chat history or create new
    let chatHistory = [];
    if (fs.existsSync(chatFile)) {
      const data = fs.readFileSync(chatFile, 'utf8');
      chatHistory = JSON.parse(data);
    }
    
    // Add new message to history
    chatHistory.push({
      id: Date.now().toString(),
      message: messageText,
      mediaUrl: message.mediaUrl || null,
      mediaType: message.mediaType || null,
      direction: isFromMe ? 'outgoing' : 'incoming',
      timestamp: new Date().toISOString(),
      status: isFromMe ? 'sent' : 'received',
      pushname: pushname || (isFromMe ? 'Me' : cleanJid)
    });
    
    // Save back to file (limit to last 100 messages to prevent large files)
    if (chatHistory.length > 100) {
      chatHistory = chatHistory.slice(chatHistory.length - 100);
    }
    fs.writeFileSync(chatFile, JSON.stringify(chatHistory, null, 2));
    
    return true;
  } catch (error) {
    console.error('Error saving chat to file:', error);
    return false;
  }
}

function getChatHistory(remoteJid) {
  try {
    // Clean jid to use as filename (remove @s.whatsapp.net)
    const cleanJid = remoteJid.replace(/@.+/, '');
    const chatFile = path.join(__dirname, 'data', 'chats', `${cleanJid}.json`);
    
    if (fs.existsSync(chatFile)) {
      const data = fs.readFileSync(chatFile, 'utf8');
      return JSON.parse(data);
    }
    return [];
  } catch (error) {
    console.error('Error reading chat history:', error);
    return [];
  }
}

const reloadEnv = () => {
  const env = fs.readFileSync('.env', 'utf8');
  env.split('\n').forEach(line => {
    const [key, value] = line.split('=');
    if (key && value) process.env[key.trim()] = value.trim();
  });
};

app.use('/', basicAuth({
  users: { 'lalaraya': 'pionergh123' },
  challenge: true,
}));

app.get('/qr', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/crm', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'crm.html'));
});





// CRM API endpoints
app.get('/api/customers', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('data_pelanggan')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data || []);
  } catch (error) {
    console.error('Error fetching customers:', error);
    res.status(500).json({ error: error.message });
  }
});

// New endpoint to get chat templates
app.get('/api/chat-templates', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('chat_template')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data || []);
  } catch (error) {
    console.error('Error fetching chat templates:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update AI status
app.put('/api/customers/:id/ai-status', async (req, res) => {
  try {
    const { id } = req.params;
    const { ai_disabled } = req.body;
    
    const { data, error } = await supabase
      .from('data_pelanggan')
      .update({ ai_disabled })
      .eq('id', id)
      .select();

    if (error) throw error;
    res.json(data[0]);
  } catch (error) {
    console.error('Error updating AI status:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update customer status
app.put('/api/customers/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { customerstatus } = req.body;
    
    const { data, error } = await supabase
      .from('data_pelanggan')
      .update({ customerstatus })
      .eq('id', id)
      .select();

    if (error) throw error;
    res.json(data[0]);
  } catch (error) {
    console.error('Error updating status:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update customer note
app.put('/api/customers/:id/note', async (req, res) => {
  try {
    const { id } = req.params;
    const { note } = req.body;
    
    const { data, error } = await supabase
      .from('data_pelanggan')
      .update({ note })
      .eq('id', id)
      .select();

    if (error) throw error;
    res.json(data[0]);
  } catch (error) {
    console.error('Error updating note:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update customer to-do task
app.put('/api/customers/:id/todo', async (req, res) => {
  try {
    const { id } = req.params;
    const { to_do } = req.body;
    
    const { data, error } = await supabase
      .from('data_pelanggan')
      .update({ to_do })
      .eq('id', id)
      .select();

    if (error) throw error;
    res.json(data[0]);
  } catch (error) {
    console.error('Error updating to-do task:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update customer details
app.put('/api/customers/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, no_hp, customer_status, ai_disabled } = req.body;
    
    const { data, error } = await supabase
      .from('data_pelanggan')
      .update({ name, no_hp, customerstatus: customer_status, ai_disabled })
      .eq('id', id)
      .select();

    if (error) throw error;
    res.json(data[0]);
  } catch (error) {
    console.error('Error updating customer:', error);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/customers/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const { error } = await supabase
      .from('data_pelanggan')
      .delete()
      .eq('id', id);

    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting customer:', error);
    res.status(500).json({ error: error.message });
  }
});

// Notification system
let notifications = [];
let notificationId = 1;
let connectedClients = new Set();

// Load notifications from JSON file
function loadNotificationsFromFile() {
  try {
    if (fs.existsSync('./notifications.json')) {
      const data = fs.readFileSync('./notifications.json', 'utf8');
      const savedData = JSON.parse(data);
      notifications = savedData.notifications || [];
      notificationId = savedData.lastId || 1;
    }
  } catch (error) {
    console.error('Error loading notifications from file:', error);
    notifications = [];
    notificationId = 1;
  }
}

// Save notifications to JSON file
function saveNotificationsToFile() {
  try {
    const data = {
      notifications: notifications,
      lastId: notificationId,
      lastUpdated: new Date().toISOString()
    };
    fs.writeFileSync('./notifications.json', JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Error saving notifications to file:', error);
  }
}

// Load notifications on startup
loadNotificationsFromFile();

// WebSocket endpoint untuk realtime notifications
app.get('/api/notifications/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Cache-Control'
  });

  // Send initial connection message
  res.write('data: {"type": "connected", "message": "Notification stream connected"}\n\n');

  // Store this connection
  const clientId = Date.now();
  const client = { id: clientId, res };
  connectedClients.add(client);

  // Send heartbeat every 30 seconds
  const heartbeat = setInterval(() => {
    try {
      res.write('data: {"type": "heartbeat", "timestamp": "' + new Date().toISOString() + '"}\n\n');
    } catch (error) {
      clearInterval(heartbeat);
      connectedClients.delete(client);
    }
  }, 30000);

  // Remove client when connection closes
  req.on('close', () => {
    clearInterval(heartbeat);
    connectedClients.delete(client);
  });

  req.on('error', () => {
    clearInterval(heartbeat);
    connectedClients.delete(client);
  });
});

// Function to broadcast notifications to all connected clients
function broadcastNotification(type, data) {
  if (connectedClients.size === 0) return;
  
  const message = JSON.stringify({ type, data, timestamp: new Date().toISOString() });
  const disconnectedClients = [];
  
  connectedClients.forEach(client => {
    try {
      if (client.res && !client.res.destroyed) {
        client.res.write(`data: ${message}\n\n`);
      } else {
        disconnectedClients.push(client);
      }
    } catch (error) {
      console.log('Client disconnected, removing from notification stream');
      disconnectedClients.push(client);
    }
  });
  
  // Remove disconnected clients
  disconnectedClients.forEach(client => {
    connectedClients.delete(client);
  });
}

// Store push subscriptions
let pushSubscriptions = new Set();

// Load or generate VAPID keys
let vapidKeys;
try {
  const keysFile = fs.readFileSync('./vapid-keys.json', 'utf8');
  vapidKeys = JSON.parse(keysFile);
} catch (error) {
  vapidKeys = webpush.generateVAPIDKeys();
  fs.writeFileSync('./vapid-keys.json', JSON.stringify(vapidKeys, null, 2));
}

// Set VAPID details
webpush.setVapidDetails(
  'mailto:admin@example.com',
  process.env.VAPID_PUBLIC_KEY || vapidKeys.publicKey,
  process.env.VAPID_PRIVATE_KEY || vapidKeys.privateKey
);

// Function to send push notification
async function sendPushNotification(subscription, payload) {
  try {
    const result = await webpush.sendNotification(subscription, JSON.stringify(payload));
    return true;
  } catch (error) {
    console.error('Error sending push notification:', error);
    if (error.statusCode === 410) {
      console.log('Subscription expired');
    }
    return false;
  }
}

// Function to broadcast push notifications to all subscribers
async function broadcastPushNotification(notification) {
  const payload = {
    title: notification.title,
    body: notification.message,
    tag: 'whatsapp-crm-notification-' + Date.now(),
    data: {
      url: '/crm.html',
      timestamp: Date.now(),
      notification_id: notification.id
    }
  };

  if (pushSubscriptions.size === 0) {
    return;
  }

  const failedSubscriptions = [];
  let successCount = 0;
  
  for (const subscription of pushSubscriptions) {
    const success = await sendPushNotification(subscription, payload);
    if (success) {
      successCount++;
    } else {
      failedSubscriptions.push(subscription);
    }
  }
  
  // Remove failed subscriptions
  if (failedSubscriptions.length > 0) {
    failedSubscriptions.forEach(sub => pushSubscriptions.delete(sub));
  }
}

// Endpoint untuk menerima notifikasi dari n8n
app.post('/api/notifications', async (req, res) => {
  try {
    const { title, message, type = 'info', customer_id, customer_name } = req.body;
    
    const notification = {
      id: notificationId++,
      title: title || 'Notification',
      message: message || 'New notification',
      type: type, // 'info', 'success', 'warning', 'error'
      customer_id,
      customer_name,
      timestamp: new Date().toISOString(),
      read: false
    };
    
    notifications.unshift(notification); // Add to beginning
    
    // Keep only last 100 notifications
    if (notifications.length > 100) {
      notifications = notifications.slice(0, 100);
    }
    
    // Save to JSON file
    saveNotificationsToFile();
    
    // Broadcast to all connected clients
    broadcastNotification('new_notification', notification);
    
    // Send push notifications
    await broadcastPushNotification(notification);
    
    console.log('New notification received:', notification);
    
    res.json({ 
      success: true, 
      notification_id: notification.id,
      message: 'Notification created successfully'
    });
  } catch (error) {
    console.error('Error creating notification:', error);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint untuk mengambil notifikasi
app.get('/api/notifications', (req, res) => {
  try {
    const { unread_only = false } = req.query;
    
    let filteredNotifications = notifications;
    if (unread_only === 'true') {
      filteredNotifications = notifications.filter(n => !n.read);
    }
    
    res.json(filteredNotifications);
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint untuk mark notification as read
app.put('/api/notifications/:id/read', (req, res) => {
  try {
    const { id } = req.params;
    const notification = notifications.find(n => n.id == id);
    
    if (notification) {
      notification.read = true;
      saveNotificationsToFile();
      broadcastNotification('notification_updated', notification);
      res.json({ success: true, message: 'Notification marked as read' });
    } else {
      res.status(404).json({ error: 'Notification not found' });
    }
  } catch (error) {
    console.error('Error marking notification as read:', error);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint untuk mark all notifications as read
app.put('/api/notifications/read-all', (req, res) => {
  try {
    notifications.forEach(n => n.read = true);
    saveNotificationsToFile();
    broadcastNotification('all_notifications_read', { count: notifications.length });
    res.json({ success: true, message: 'All notifications marked as read' });
  } catch (error) {
    console.error('Error marking all notifications as read:', error);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint untuk subscribe push notification
app.post('/api/push/subscribe', (req, res) => {
  try {
    const { subscription } = req.body;
    
    if (!subscription || !subscription.endpoint) {
      return res.status(400).json({ error: 'Invalid subscription data' });
    }
    
    pushSubscriptions.add(subscription);
    
    res.json({ 
      success: true, 
      message: 'Push notification subscribed successfully',
      subscribers_count: pushSubscriptions.size
    });
  } catch (error) {
    console.error('Error subscribing to push notifications:', error);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint untuk unsubscribe push notification
app.post('/api/push/unsubscribe', (req, res) => {
  try {
    const { subscription } = req.body;
    
    if (!subscription || !subscription.endpoint) {
      return res.status(400).json({ error: 'Invalid subscription data' });
    }
    
    // Remove subscription by endpoint
    for (const sub of pushSubscriptions) {
      if (sub.endpoint === subscription.endpoint) {
        pushSubscriptions.delete(sub);
        break;
      }
    }
    
    res.json({ 
      success: true, 
      message: 'Push notification unsubscribed successfully',
      subscribers_count: pushSubscriptions.size
    });
  } catch (error) {
    console.error('Error unsubscribing from push notifications:', error);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint untuk get VAPID public key
app.get('/api/push/vapid-public-key', (req, res) => {
  res.json({ 
    vapidPublicKey: process.env.VAPID_PUBLIC_KEY || vapidKeys.publicKey
  });
});

// Test endpoint untuk push notification
app.post('/api/push/test', async (req, res) => {
  try {
    const testNotification = {
      id: notificationId++,
      title: 'Test Push Notification',
      message: 'This is a test push notification from WhatsApp CRM',
      type: 'info',
      customer_id: null,
      customer_name: 'Test User',
      timestamp: new Date().toISOString(),
      read: false
    };
    
    // Save to JSON file
    notifications.unshift(testNotification);
    saveNotificationsToFile();
    
    // Broadcast to all connected clients
    broadcastNotification('new_notification', testNotification);
    
    // Send push notifications
    await broadcastPushNotification(testNotification);
    
    res.json({ 
      success: true, 
      message: 'Test push notification sent',
      subscribers_count: pushSubscriptions.size,
      notification: testNotification
    });
  } catch (error) {
    console.error('Error sending test notification:', error);
    res.status(500).json({ error: error.message });
  }
});

// Debug endpoint untuk push notification
app.get('/api/push/debug', (req, res) => {
  res.json({
    subscribers_count: pushSubscriptions.size,
    vapid_public_key: process.env.VAPID_PUBLIC_KEY || vapidKeys.publicKey,
    vapid_private_key_set: !!(process.env.VAPID_PRIVATE_KEY || vapidKeys.privateKey),
    subscriptions: Array.from(pushSubscriptions).map(sub => ({
      endpoint: sub.endpoint,
      keys_present: !!sub.keys
    }))
  });
});

// Chat history endpoints
app.get('/api/chats/:number', (req, res) => {
  try {
    const { number } = req.params;
    const jid = number + '@s.whatsapp.net';
    
    const chatHistory = getChatHistory(jid);
    const unreadCount = chatHistory.filter(msg => msg.direction === 'incoming' && !msg.read).length;
    res.json({ success: true, history: chatHistory, unreadCount });
  } catch (error) {
    console.error('Error fetching chat history:', error);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint to mark all messages as read for a contact
app.post('/api/chats/:number/read', (req, res) => {
  try {
    const { number } = req.params;
    const cleanJid = number;
    const chatFile = path.join(__dirname, 'data', 'chats', `${cleanJid}.json`);
    if (!fs.existsSync(chatFile)) return res.json({ success: true });
    let chatHistory = JSON.parse(fs.readFileSync(chatFile, 'utf8'));
    let updated = false;
    chatHistory = chatHistory.map(msg => {
      if (msg.direction === 'incoming' && !msg.read) {
        updated = true;
        return { ...msg, read: true };
      }
      return msg;
    });
    if (updated) fs.writeFileSync(chatFile, JSON.stringify(chatHistory, null, 2));
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all available chat contacts
app.get('/api/chats', (req, res) => {
  try {
    const chatDir = path.join(__dirname, 'data', 'chats');
    
    if (!fs.existsSync(chatDir)) {
      fs.mkdirSync(chatDir, { recursive: true });
      res.json({ success: true, contacts: [] });
      return;
    }
    
    const files = fs.readdirSync(chatDir);
    const contacts = files
      .filter(file => file.endsWith('.json'))
      .map(file => {
        const number = path.basename(file, '.json');
        
        // Get last message and timestamp
        const chatHistory = getChatHistory(number + '@s.whatsapp.net');
        const lastMessage = chatHistory.length > 0 ? chatHistory[chatHistory.length - 1] : null;
        
        // Find contact name from recent messages
        let contactName = number;
        if (chatHistory.length > 0) {
          // Look for incoming messages with pushname
          const incomingMessages = chatHistory.filter(msg => msg.direction === 'incoming' && msg.pushname && msg.pushname !== number);
          if (incomingMessages.length > 0) {
            contactName = incomingMessages[incomingMessages.length - 1].pushname;
          }
        }
        
        return {
          number,
          contactName,
          lastMessage: lastMessage ? lastMessage.message : '',
          lastTimestamp: lastMessage ? lastMessage.timestamp : null,
          messageCount: chatHistory.length
        };
      })
      .sort((a, b) => {
        if (!a.lastTimestamp) return 1;
        if (!b.lastTimestamp) return -1;
        return new Date(b.lastTimestamp) - new Date(a.lastTimestamp);
      });
    
    res.json({ success: true, contacts });
  } catch (error) {
    console.error('Error fetching chat contacts:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/status', (req, res) => {
  res.json({
    status: connectionStatus,
    number: connectedNumber,
    qr: latestQR
      ? `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(latestQR)}&size=250x250`
      : null,
  });
});

app.post('/disconnect', async (req, res) => {
  try {
    if (sock?.logout) {
      await sock.logout();
    }

    rimraf.sync('./auth_info');
    connectionStatus = 'disconnected';
    latestQR = null;
    connectedNumber = null;

    setTimeout(() => startSock(), 1000);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.post('/send-image', async (req, res) => {
  const { number, image_url, caption, is_ai_reply, pushname } = req.body;
  const jid = number + '@s.whatsapp.net';

  try {
    const response = await fetch(image_url);
    if (!response.ok) throw new Error('Gagal download gambar dari URL');
    const buffer = await response.buffer();

    // For AI messages, we'll track them to avoid duplicates when the message event fires
    if (is_ai_reply) {
      const combinedKey = `${jid}|${caption || '[Image sent]'}`;
      sentByAI.add(combinedKey);
      
      // Save to chat history first
      saveChatToFile(jid, { 
        text: caption || '[Image sent]',
        mediaUrl: image_url,
        mediaType: 'image'
      }, true, pushname || 'AI Assistant');
    }

    const result = await sock.sendMessage(jid, {
      image: buffer,
      caption: caption || '',
    });

    res.json({ status: 'success', messageId: result?.key?.id || null });
  } catch (e) {
    res.status(500).json({ status: 'error', error: e.message });
  }
});

app.post('/send-image-upload', upload.single('image'), async (req, res) => {
  const { number, caption, pushname } = req.body;
  const jid = number + '@s.whatsapp.net';
  const filePath = req.file.path;
  try {
    // Validasi: hanya file gambar
    if (!req.file.mimetype.startsWith('image/')) {
      fs.unlinkSync(filePath);
      return res.status(400).json({ status: 'error', error: 'File is not an image.' });
    }
    const buffer = fs.readFileSync(filePath);
    const result = await sock.sendMessage(jid, {
      image: buffer,
      caption: caption || '',
    });
    saveChatToFile(jid, { text: caption || '[Image sent]', mediaUrl: '', mediaType: 'image' }, true, pushname || 'Me');
    fs.unlinkSync(filePath);
    res.json({ status: 'success', messageId: result?.key?.id || null });
  } catch (e) {
    res.status(500).json({ status: 'error', error: e.message });
  }
});

app.post('/send-document-upload', upload.single('document'), async (req, res) => {
  const { number, caption, pushname } = req.body;
  const jid = number + '@s.whatsapp.net';
  const filePath = req.file.path;
  try {
    // Validasi: bukan file gambar
    if (req.file.mimetype.startsWith('image/')) {
      fs.unlinkSync(filePath);
      return res.status(400).json({ status: 'error', error: 'File is an image, not a document.' });
    }
    const buffer = fs.readFileSync(filePath);
    const result = await sock.sendMessage(jid, {
      document: buffer,
      fileName: caption || req.file.originalname,
      mimetype: req.file.mimetype,
    });
    saveChatToFile(jid, { text: caption || '[Document sent]', mediaUrl: '', mediaType: 'document' }, true, pushname || 'Me');
    fs.unlinkSync(filePath);
    res.json({ status: 'success', messageId: result?.key?.id || null });
  } catch (e) {
    res.status(500).json({ status: 'error', error: e.message });
  }
});


app.post('/start-typing', async (req, res) => {
  const { number } = req.body;
  const jid = number + '@s.whatsapp.net';

  try {
    await sock.sendPresenceUpdate('composing', jid);
    res.json({ status: 'success', action: 'typing started' });
  } catch (e) {
    res.status(500).json({ status: 'error', error: e.message });
  }
});

app.post('/stop-typing', async (req, res) => {
  const { number } = req.body;
  const jid = number + '@s.whatsapp.net';

  try {
    await sock.sendPresenceUpdate('paused', jid);
    res.json({ status: 'success', action: 'typing stopped' });
  } catch (e) {
    res.status(500).json({ status: 'error', error: e.message });
  }
});

app.post('/read-message', async (req, res) => {
  const { remoteJid, messageId } = req.body;

  try {
    await sock.readMessages([
      {
        remoteJid,
        id: messageId,
        fromMe: false,
      },
    ]);
    res.json({ status: 'success', action: 'message marked as read' });
  } catch (e) {
    res.status(500).json({ status: 'error', error: e.message });
  }
});



app.post('/send-text', async (req, res) => {
  const { number, message, is_ai_reply, pushname } = req.body;
  const jid = number + '@s.whatsapp.net';

  try {
    // Save message to chat history first (for API-generated messages)
    if (is_ai_reply) {
      // For AI messages, we'll track them to avoid duplicates when the message event fires
      const combinedKey = `${jid}|${message}`;
      sentByAI.add(combinedKey);

      // For API calls, save directly to chat history
      saveChatToFile(jid, { text: message }, true, pushname || 'AI Assistant');
    }

    // Send the actual message
    const result = await sock.sendMessage(jid, { text: message });

    res.json({ status: 'success', messageId: result?.key?.id || null });
  } catch (e) {
    res.status(500).json({ status: 'error', error: e.message });
  }
});




app.post('/send-text-ai', async (req, res) => {
  const { number, message, is_ai_reply, pushname } = req.body;
  const jid = number + '@s.whatsapp.net';

  try {
    // For AI messages, track them to avoid duplicates
    const combinedKey = `${jid}|${message}`;
    sentByAI.add(combinedKey);
    
    // Save to chat history first
    saveChatToFile(jid, { 
      text: message,
      footer: 'Powered by Nveeta'
    }, true, pushname || 'AI Assistant');

    const result = await sock.sendMessage(jid, {
      text: message,
      footer: 'Powered by Nveeta' // Ganti ini sesuai kebutuhanmu
    });

    res.json({ status: 'success', messageId: result?.key?.id || null });
  } catch (e) {
    res.status(500).json({ status: 'error', error: e.message });
  }
});


function saveBufferToFile(buffer, ext) {
  const fileName = `${Date.now()}.${ext}`;
  const dir = path.join(__dirname, 'tmp');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);
  const filePath = path.join(dir, fileName);
  fs.writeFileSync(filePath, buffer);
  return `https://wa.lalaraya.my.id/media/${fileName}`;
}

async function startSock() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info');
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    browser: ['Ubuntu', 'Chrome', '22.04'],
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', update => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      latestQR = qr;
      connectionStatus = 'connecting';
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      connectionStatus = 'disconnected';
      latestQR = null;

      if (statusCode === 401 || !shouldReconnect) {
        rimraf.sync('./auth_info');
      }

      if (shouldReconnect || statusCode === 401) {
        setTimeout(() => startSock(), 1000);
      }
    }

    if (connection === 'open') {
      connectionStatus = 'connected';
      latestQR = null;
      connectedNumber = sock?.user?.id?.split(':')[0];
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message) return;

    const isFromMe = msg.key.fromMe;
    const sender = msg.key.remoteJid.replace(/@.+/, '');
    const remoteJid = msg.key.remoteJid;
    const messageId = msg.key.id;
    const pushname = msg.pushName || msg.key.participant || '';
    const type = Object.keys(msg.message)[0];
    let text = '[non-text]';
    let mediaUrl = null;
    let mediaType = null;

    try {
      if (msg.message.imageMessage) {
        text = msg.message.imageMessage?.caption || '[Image]';
        mediaType = 'image';

        const originalBuffer = await downloadMediaMessage(msg, 'buffer', {}, {
          logger: sock.logger,
          reuploadRequest: sock.updateMediaMessage,
        });

        const compressedBuffer = await sharp(originalBuffer)
          .resize({ width: 1024 })
          .jpeg({ quality: 60 })
          .toBuffer();

        mediaUrl = saveBufferToFile(compressedBuffer, 'jpg');

      } else if (msg.message.audioMessage) {
        const isVoice = msg.message.audioMessage.ptt;
        text = isVoice ? '[Voice Note]' : '[Audio]';
        mediaType = isVoice ? 'voice' : 'audio';

        const buffer = await downloadMediaMessage(msg, 'buffer', {}, {
          logger: sock.logger,
          reuploadRequest: sock.updateMediaMessage,
        });

        mediaUrl = saveBufferToFile(buffer, 'mp3');

      } else if (msg.message.videoMessage) {
        text = msg.message.videoMessage?.caption || '[Video]';
        mediaType = 'video';

        const buffer = await downloadMediaMessage(msg, 'buffer', {}, {
          logger: sock.logger,
          reuploadRequest: sock.updateMediaMessage,
        });

        mediaUrl = saveBufferToFile(buffer, 'mp4');

      } else if (msg.message.documentMessage) {
        const fileName = msg.message.documentMessage.fileName || '';
        const ext = fileName.split('.').pop()?.toLowerCase() || 'doc';
        text = `[Document] ${fileName}`;
        mediaType = 'document';

        const buffer = await downloadMediaMessage(msg, 'buffer', {}, {
          logger: sock.logger,
          reuploadRequest: sock.updateMediaMessage,
        });

        if (['jpg', 'jpeg', 'png'].includes(ext)) {
          // Kompres jika file gambar dikirim sebagai dokumen
          const compressedBuffer = await sharp(buffer)
            .resize({ width: 1024 })
            .jpeg({ quality: 60 })
            .toBuffer();

          mediaUrl = saveBufferToFile(compressedBuffer, 'jpg');
        } else {
          // Simpan file biasa
          mediaUrl = saveBufferToFile(buffer, ext);
        }

      } else {
        text = msg.message.conversation || msg.message.extendedTextMessage?.text || '[non-text]';
        mediaType = null;
      }
    } catch (err) {
      console.error('❌ Gagal download media:', err.message);
    }

    const combinedKey = `${remoteJid}|${text}`;

    // For outgoing messages, check if it was sent by AI
    if (isFromMe) {
      if (sentByAI.has(combinedKey)) {
        console.log('Message was sent by AI, skipping webhook and storage');
        sentByAI.delete(combinedKey);
        return;
      }

      // This is a manual message from the user, save it
      saveChatToFile(remoteJid, { 
        text, 
        mediaUrl, 
        mediaType,
        caption: msg.message.imageMessage?.caption || msg.message.videoMessage?.caption || null
      }, isFromMe, 'Me'); // Use 'Me' for manual outgoing messages

      try {
        reloadEnv();
        await fetch(process.env.WEBHOOK_MANUAL_REPLY, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: sender,
            message: text,
            message_id: messageId,
            pushname: pushname,
          }),
        });
      } catch (err) {
        console.error('❌ Gagal kirim ke webhook manual-reply:', err.message);
      }

      return;
    }

    // This is an incoming message, save it
    saveChatToFile(remoteJid, { 
      text, 
      mediaUrl, 
      mediaType,
      caption: msg.message.imageMessage?.caption || msg.message.videoMessage?.caption || null
    }, isFromMe, pushname);

    try {
      reloadEnv();
      await fetch(process.env.WEBHOOK_AI_REPLY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: sender,
          message: text,
          type,
          media_url: mediaUrl,
          raw: msg,
        }),
      });
    } catch (err) {
      console.error('❌ Gagal kirim ke webhook ai-reply-bot:', err.message);
    }
  });
}

startSock();

app.listen(port, '0.0.0.0', () =>
  console.log(`🚀 WhatsApp API aktif di http://localhost:${port}`)
);
