const qrImage = document.getElementById('qrImage');
const statusText = document.getElementById('statusText');
const numberText = document.getElementById('numberText');
const disconnectBtn = document.getElementById('disconnectBtn');

async function fetchStatus() {
  try {
    const res = await fetch('/status');
    const data = await res.json();

    // Update status text berdasarkan status koneksi
    if (data.status === 'connected') {
      statusText.textContent = 'WhatsApp Terhubung';
      numberText.textContent = data.number ? `Nomor: ${data.number}` : '';
      qrImage.style.display = 'none';
      disconnectBtn.style.display = 'inline-block';
    } else if (data.status === 'disconnected') {
      statusText.textContent = 'Menunggu QR Code...';
      numberText.textContent = '';
      qrImage.style.display = 'none';
      disconnectBtn.style.display = 'none';
    } else if (data.status === 'connecting') {
      statusText.textContent = 'Menghubungkan ke WhatsApp...';
      numberText.textContent = '';
    }

    // Tampilkan QR jika tersedia
    if (data.qr) {
      statusText.textContent = 'Scan QR Code untuk login';
      qrImage.src = data.qr;
      qrImage.style.display = 'block';
      qrImage.alt = 'WhatsApp QR Code';
      disconnectBtn.style.display = 'none';
    }
  } catch (err) {
    console.error('Gagal ambil status:', err);
    statusText.textContent = 'Error koneksi ke server';
  }
}

setInterval(fetchStatus, 5000);
fetchStatus();

disconnectBtn.addEventListener('click', async () => {
  try {
    // Konfirmasi logout
    const confirmed = confirm('Anda yakin ingin logout dari WhatsApp?');
    if (!confirmed) return;

    // Update UI saat proses logout
    statusText.textContent = 'Memutuskan koneksi...';
    disconnectBtn.style.display = 'none';
    qrImage.style.display = 'none';
    
    const res = await fetch('/disconnect', { 
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (!res.ok) {
      throw new Error('Gagal memutuskan koneksi');
    }

    // Reset UI
    statusText.textContent = 'Menunggu QR Code baru...';
    numberText.textContent = '';

    // Polling untuk QR baru
    let attempts = 0;
    const maxAttempts = 10;
    
    const checkForQR = async () => {
      if (attempts >= maxAttempts) {
        window.location.reload();
        return;
      }

      const statusRes = await fetch('/status');
      const statusData = await statusRes.json();

      if (statusData.qr) {
        qrImage.src = statusData.qr;
        qrImage.style.display = 'block';
        statusText.textContent = 'Scan QR Code untuk login';
      } else {
        attempts++;
        setTimeout(checkForQR, 1000);
      }
    };

    // Mulai polling setelah jeda singkat
    setTimeout(checkForQR, 2000);

  } catch (error) {
    console.error('Error:', error);
    alert('Gagal logout: ' + error.message);
    // Kembalikan tampilan tombol
    disconnectBtn.style.display = 'inline-block';
  }
});
