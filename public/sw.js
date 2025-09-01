// Service Worker untuk Push Notifications

// Install event - tanpa cache
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

// Activate event
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Push notification event
self.addEventListener('push', (event) => {
  let notificationData = {
    title: 'WhatsApp CRM',
    body: 'New notification',
    tag: 'whatsapp-crm-notification-' + Date.now(),
    data: {
      url: '/crm.html',
      timestamp: Date.now()
    }
  };

  if (event.data) {
    try {
      const data = event.data.json();
      notificationData = {
        ...notificationData,
        title: data.title || notificationData.title,
        body: data.body || data.message || notificationData.body,
        tag: data.tag || notificationData.tag + '-' + Date.now(),
        data: {
          ...notificationData.data,
          ...data.data
        }
      };
    } catch (error) {
      console.error('Error parsing push data:', error);
      try {
        const textData = event.data.text();
        notificationData.body = textData;
      } catch (textError) {
        console.error('Error parsing text data:', textError);
      }
    }
  }

  const options = {
    body: notificationData.body,
    tag: notificationData.tag,
    data: notificationData.data,
    requireInteraction: false,
    silent: false,
    vibrate: [200, 100, 200],
    renotify: true
  };

  event.waitUntil(
    self.registration.showNotification(notificationData.title, options)
      .catch((error) => {
        console.error('Error showing notification:', error);
      })
  );
});

// Notification click event
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow('/crm.html')
  );
});

// Background sync (if supported)
self.addEventListener('sync', (event) => {
  if (event.tag === 'background-sync') {
    event.waitUntil(doBackgroundSync());
  }
});

function doBackgroundSync() {
  // Handle background sync tasks
} 