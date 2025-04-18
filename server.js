const express = require('express');
const axios = require('axios');
const cors = require('cors');
const compression = require('compression');
const { pipeline, Transform } = require('stream');

// Configuration
const config = {
  provider: {
    url: 'http://ProviderURL',
    username: 'USER',
    password: 'PASS'
  },
  port: 8000
};

const app = express();
app.use(cors());
app.use(compression());

// Logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.originalUrl}`);
  next();
});

// Playlist route (rewrite URLs to local proxy)
app.get('/playlist.m3u', async (req, res) => {
  try {
    const playlistUrl = `${config.provider.url}/get.php?username=${config.provider.username}&password=${config.provider.password}&type=m3u_plus`;
    const response = await axios.get(playlistUrl, { responseType: 'stream' });

    res.setHeader('Content-Type', 'application/x-mpegurl');

    const transform = new Transform({
      transform(chunk, encoding, callback) {
        const rewritten = chunk.toString().replace(
          new RegExp(config.provider.url, 'g'),
          `http://${req.hostname}:${config.port}`
        );
        callback(null, rewritten);
      }
    });

    pipeline(response.data, transform, res, (err) => {
      if (err) console.error('Pipeline error:', err);
    });
  } catch (err) {
    console.error('Playlist error:', err.message);
    res.status(500).send('Playlist fetch failed.');
  }
});

// EPG XML passthrough
app.get('/epg.xml', async (req, res) => {
  try {
    const epgUrl = `${config.provider.url}/xmltv.php?username=${config.provider.username}&password=${config.provider.password}`;
    const response = await axios.get(epgUrl, { responseType: 'stream' });

    res.setHeader('Content-Type', 'application/xml');
    response.data.pipe(res);
  } catch (err) {
    console.error('EPG error:', err.message);
    res.status(500).send('EPG fetch failed.');
  }
});

// Proxy handler for live + VOD
app.use('/', async (req, res) => {
  try {
    const targetUrl = `${config.provider.url}${req.path}?username=${config.provider.username}&password=${config.provider.password}`;
    console.log(`Proxying to: ${targetUrl}`);

    const axiosConfig = {
      method: req.method,
      url: targetUrl,
      params: req.query,
      responseType: 'stream',
      headers: {
        'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0',
        'Accept': 'video/*',
        'Connection': 'keep-alive',
        'Accept-Encoding': 'identity'
      }
    };

    if (req.headers.range) {
      axiosConfig.headers['Range'] = req.headers.range;
    }

    const response = await axios(axiosConfig);

    // Pass through important headers
    const passthroughHeaders = [
      'content-type', 'content-length', 'accept-ranges',
      'content-range', 'cache-control', 'content-disposition'
    ];

    passthroughHeaders.forEach((key) => {
      const value = response.headers[key];
      if (value) res.setHeader(key, value);
    });

    // Set default headers if not provided
    if (!res.getHeader('Accept-Ranges')) res.setHeader('Accept-Ranges', 'bytes');
    if (req.headers.range && response.status === 200) {
      res.status(206); // Partial Content
    } else {
      res.status(response.status);
    }

    response.data.pipe(res);
  } catch (err) {
    console.error('Proxy error:', err.message);
    if (!res.headersSent) {
      res.status(500).send('Proxy error');
    }
  }
});

// Health check
app.get('/status', (req, res) => {
  res.json({ status: 'running' });
});

// Start server
app.listen(config.port, '0.0.0.0', () => {
  console.log(`IPTV Proxy Server running on port ${config.port}`);
});
