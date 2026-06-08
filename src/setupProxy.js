// 开发环境反向代理：把 /api 请求转发到上游 NewAPI 站点，
// 这样前端与接口同源，可绕过浏览器对 /api/log/self 等无 CORS 接口的限制。
const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function (app) {
  const target = process.env.REACT_APP_UPSTREAM || 'https://ai.xxturbo.com';
  app.use(
    '/api',
    createProxyMiddleware({
      target,
      changeOrigin: true,
      secure: true,
    }),
  );
};
