import "dotenv/config";
import { platform } from "os";

// Platform-specific user agents for consistency (avoid fingerprint mismatch)
const USER_AGENTS = {
  darwin: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  linux: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  win32: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
};

const getDefaultUserAgent = () => USER_AGENTS[platform()] || USER_AGENTS.linux;

export const config = {
  server: {
    host: process.env.HOST || '0.0.0.0',
    port: process.env.PORT || 8080,
    timeout: process.env.TIMEOUT || 60 * 60 * 1000,
    cors: {
      origin: process.env.CORS_ORIGIN || '*',
      headers: process.env.CORS_HEADERS || '*',
    },
  },
  browser: {
    headless: process.env.BROWSER_HEADLESS !== 'false',
    defaultUrl: process.env.DEFAULT_URL || 'https://www.tiktok.com/@rihanna?lang=en',
    userAgent: process.env.USER_AGENT || getDefaultUserAgent(),
    proxyUrl: process.env.PROXY_URL || null,
    executablePath: process.env.EXECUTABLE_PATH || null, // e.g., "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" for macOS
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--window-size=1920,1080',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      // Enable WebRTC and network features for TikTok detection bypass
      '--enable-webrtc',
      '--enable-usermedia-screen-capturing',
      '--disable-features=WebRtcHideLocalIpsWithMdns',
      '--force-webrtc-ip-handling-policy=default',
    ],
  },
  encryption: {
    password: 'webapp1.0+202106',
  },
  scripts: [
    'signer.js',
    'webmssdk.js',
    'xbogus.js',
  ],
  rateLimit: {
    windowMs: 15 * 60 * 1000,
    max: 100,
  },
  monitoring: {
    enabled: process.env.MONITORING_ENABLED !== 'false',
    defaultUrl: process.env.MONITORING_URL || process.env.DEFAULT_URL || 'https://www.tiktok.com/@rihanna?lang=en',
    interval: parseInt(process.env.MONITORING_INTERVAL) || 60 * 60 * 1000, // 1 hour
    logDir: process.env.LOG_DIR || 'logs',
    logFile: 'api_monitoring.log',
    msToken: process.env.MS_TOKEN || null, // msToken cookie for authenticated requests
  },
};