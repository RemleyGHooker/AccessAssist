import { createApp } from './app.js';

const port = Number(process.env.PORT) || 8080;
createApp().listen(port, () => {
  console.log(JSON.stringify({ severity: 'INFO', message: `AccessAssist listening on ${port}` }));
});
