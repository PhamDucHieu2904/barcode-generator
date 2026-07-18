// Proxy nhỏ để bypass CORS cho ComfyUI
// Chạy: node comfy_proxy.js
const http = require('http');

const COMFYUI_HOST = '127.0.0.1';
const COMFYUI_PORT = 8188;
const PROXY_PORT   = 8189;

const server = http.createServer((req, res) => {
  // Thêm CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Forward request sang ComfyUI (xóa origin/referer để tránh 403)
  const forwardHeaders = { ...req.headers };
  delete forwardHeaders['origin'];
  delete forwardHeaders['referer'];
  forwardHeaders['host'] = `${COMFYUI_HOST}:${COMFYUI_PORT}`;

  const options = {
    hostname: COMFYUI_HOST,
    port:     COMFYUI_PORT,
    path:     req.url,
    method:   req.method,
    headers:  forwardHeaders,
  };

  const proxy = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, {
      ...proxyRes.headers,
      'Access-Control-Allow-Origin': '*',
    });
    proxyRes.pipe(res, { end: true });
  });

  proxy.on('error', (err) => {
    console.error('Proxy error:', err.message);
    res.writeHead(502);
    res.end('ComfyUI không chạy! Hãy khởi động ComfyUI trước.');
  });

  req.pipe(proxy, { end: true });
});

server.listen(PROXY_PORT, () => {
  console.log(`✅ ComfyUI Proxy đang chạy tại http://127.0.0.1:${PROXY_PORT}`);
  console.log(`   → Chuyển tiếp sang ComfyUI tại http://${COMFYUI_HOST}:${COMFYUI_PORT}`);
  console.log(`   → Giữ cửa sổ này mở khi dùng AI Fill`);
});
