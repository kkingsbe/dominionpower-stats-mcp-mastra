export const TFA_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Dominion Energy — TFA</title>
<style>
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #1a1a2e; color: #eee; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
.card { background: #16213e; padding: 2rem; border-radius: 8px; width: 400px; text-align: center; }
h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
p { color: #aaa; margin-bottom: 1.5rem; }
input { width: 200px; padding: 0.75rem; margin-bottom: 1rem; border: 1px solid #333; border-radius: 4px; background: #0f3460; color: #eee; text-align: center; font-size: 1.5rem; letter-spacing: 0.5rem; }
button { background: #e94560; color: #fff; border: none; padding: 0.75rem 2rem; border-radius: 4px; cursor: pointer; }
.error { color: #e94560; margin-top: 1rem; }
.success { color: #4ecca3; margin-top: 1rem; }
</style>
</head>
<body>
<div class="card">
  <h1>Two-Factor Authentication</h1>
  <p>Enter the verification code sent to your phone.</p>
  <form id="tfaForm">
    <input type="text" id="code" name="code" maxlength="6" inputmode="numeric" pattern="[0-9]*" autocomplete="one-time-code" required>
    <button type="submit">Verify</button>
  </form>
  <div id="status"></div>
</div>
<script>
document.getElementById('tfaForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const status = document.getElementById('status');
  status.className = '';
  status.textContent = 'Verifying...';
  try {
    const res = await fetch('/admin/tfa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: document.getElementById('code').value }),
    });
    const data = await res.json();
    if (res.ok) {
      status.className = 'success';
      status.textContent = 'Verification successful! You can close this window.';
      document.getElementById('tfaForm').style.display = 'none';
      return;
    }
    status.className = 'error';
    if (data.action === 'restarting_auth') {
      status.textContent = 'That code is no longer valid. A new authentication is starting — a fresh SMS code will arrive shortly. Reload this page in a minute.';
      document.getElementById('tfaForm').style.display = 'none';
    } else {
      status.textContent = data.error || 'Verification failed';
    }
  } catch {
    status.className = 'error';
    status.textContent = 'Connection error — please reload the page';
  }
});
</script>
</body>
</html>
`;
