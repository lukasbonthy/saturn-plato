const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const cheerio = require('cheerio');
const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-this-in-production';
const USERS_FILE = path.join(__dirname, 'data', 'users.json');

const MOVIES = [
  { title: 'Interstellar', year: 2014, genre: 'Sci-Fi', blurb: 'A huge space story about time, love, and survival.' },
  { title: 'Spider-Man: Into the Spider-Verse', year: 2018, genre: 'Animation', blurb: 'Fast, stylish, and one of the most fun superhero movies.' },
  { title: 'Inception', year: 2010, genre: 'Sci-Fi', blurb: 'Dreams inside dreams with a super clean visual style.' },
  { title: 'Dune: Part Two', year: 2024, genre: 'Sci-Fi', blurb: 'Massive scale, sand, war, prophecy, and insane visuals.' },
  { title: 'The Dark Knight', year: 2008, genre: 'Action', blurb: 'A serious comic-book movie with an iconic villain.' },
  { title: 'Whiplash', year: 2014, genre: 'Drama', blurb: 'Intense, loud, and stressful in the best way.' },
  { title: 'Top Gun: Maverick', year: 2022, genre: 'Action', blurb: 'Jets, speed, pressure, and a very rewatchable story.' },
  { title: 'The Lord of the Rings: The Return of the King', year: 2003, genre: 'Fantasy', blurb: 'Big battles, strong emotion, and a legendary ending.' }
];

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use('/public', express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(express.json({ limit: '2mb' }));
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      maxAge: 1000 * 60 * 60 * 24 * 7
    }
  })
);

app.use(async (req, res, next) => {
  await ensureUsersFile();
  res.locals.user = req.session.user || null;
  res.locals.currentPath = req.path;
  next();
});

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  next();
}

async function ensureUsersFile() {
  try {
    await fs.access(USERS_FILE);
  } catch {
    await fs.mkdir(path.dirname(USERS_FILE), { recursive: true });
    await fs.writeFile(USERS_FILE, '[]', 'utf8');
  }
}

async function getUsers() {
  await ensureUsersFile();
  const raw = await fs.readFile(USERS_FILE, 'utf8');
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function saveUsers(users) {
  await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
}

function normalizeUrl(input) {
  const trimmed = String(input || '').trim();
  if (!trimmed) return null;

  try {
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const url = new URL(withProtocol);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return url;
  } catch {
    return null;
  }
}

function buildProxyHref(url) {
  return `/saturn/browse?url=${encodeURIComponent(url)}`;
}

function shouldIgnoreLink(value) {
  if (!value) return true;
  const lowered = value.trim().toLowerCase();
  return (
    lowered.startsWith('#') ||
    lowered.startsWith('javascript:') ||
    lowered.startsWith('data:') ||
    lowered.startsWith('mailto:') ||
    lowered.startsWith('tel:') ||
    lowered.startsWith('blob:') ||
    lowered.startsWith('about:')
  );
}

function resolveAgainst(baseUrl, value) {
  try {
    return new URL(value, baseUrl).href;
  } catch {
    return null;
  }
}

function rewriteSrcset(srcset, baseUrl) {
  return srcset
    .split(',')
    .map((part) => {
      const trimmed = part.trim();
      if (!trimmed) return trimmed;
      const segments = trimmed.split(/\s+/);
      const src = segments.shift();
      if (!src || shouldIgnoreLink(src)) return trimmed;
      const absolute = resolveAgainst(baseUrl, src);
      if (!absolute) return trimmed;
      return [buildProxyHref(absolute), ...segments].join(' ');
    })
    .join(', ');
}

function rewriteCss(css, baseUrl) {
  const urlPattern = /url\((['"]?)(.*?)\1\)/gi;
  const importPattern = /@import\s+(?:url\()?['"]([^'"]+)['"]\)?/gi;

  const firstPass = css.replace(urlPattern, (match, quote, asset) => {
    const clean = String(asset || '').trim();
    if (shouldIgnoreLink(clean)) return match;
    const absolute = resolveAgainst(baseUrl, clean);
    if (!absolute) return match;
    return `url("${buildProxyHref(absolute)}")`;
  });

  return firstPass.replace(importPattern, (match, asset) => {
    if (shouldIgnoreLink(asset)) return match;
    const absolute = resolveAgainst(baseUrl, asset);
    if (!absolute) return match;
    return `@import url("${buildProxyHref(absolute)}")`;
  });
}

function injectToolbar($, activeUrl) {
  const toolbar = `
    <div class="saturn-toolbar">
      <div class="saturn-left">
        <a class="saturn-brand" href="/dashboard">◀ Dashboard</a>
        <span class="saturn-tag">Saturn Proxy</span>
      </div>
      <form class="saturn-form" method="GET" action="/saturn/browse">
        <input type="text" name="url" value="${String(activeUrl).replace(/"/g, '&quot;')}" placeholder="https://example.com" />
        <button type="submit">Go</button>
      </form>
    </div>
    <style>
      body { padding-top: 82px !important; }
      .saturn-toolbar {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        z-index: 2147483647;
        display: flex;
        gap: 12px;
        align-items: center;
        justify-content: space-between;
        padding: 14px 16px;
        background: rgba(8, 10, 18, 0.96);
        color: #fff;
        backdrop-filter: blur(14px);
        border-bottom: 1px solid rgba(255,255,255,0.12);
        font-family: Arial, sans-serif;
      }
      .saturn-left {
        display: flex;
        align-items: center;
        gap: 10px;
        min-width: 0;
      }
      .saturn-brand {
        color: #fff;
        text-decoration: none;
        font-weight: 700;
        white-space: nowrap;
      }
      .saturn-tag {
        color: #a6b1ff;
        font-size: 13px;
        white-space: nowrap;
      }
      .saturn-form {
        display: flex;
        align-items: center;
        gap: 8px;
        width: min(760px, 100%);
      }
      .saturn-form input {
        width: 100%;
        padding: 11px 12px;
        border-radius: 12px;
        border: 1px solid rgba(255,255,255,0.14);
        background: rgba(255,255,255,0.08);
        color: #fff;
      }
      .saturn-form button {
        border: 0;
        border-radius: 12px;
        padding: 11px 15px;
        font-weight: 700;
        cursor: pointer;
      }
      @media (max-width: 700px) {
        .saturn-toolbar {
          flex-direction: column;
          align-items: stretch;
        }
        body { padding-top: 128px !important; }
      }
    </style>
  `;

  $('body').prepend(toolbar);
}

function rewriteHtml(html, baseUrl) {
  const $ = cheerio.load(html, { decodeEntities: false });

  $('meta[http-equiv="Content-Security-Policy"]').remove();

  $('a[href], link[href], script[src], img[src], iframe[src], source[src], video[src], audio[src], embed[src], object[data]').each((_, el) => {
    const attrib = el.attribs.href ? 'href' : el.attribs.src ? 'src' : el.attribs.data ? 'data' : null;
    if (!attrib) return;

    const current = $(el).attr(attrib);
    if (shouldIgnoreLink(current)) return;

    const absolute = resolveAgainst(baseUrl, current);
    if (!absolute) return;

    $(el).attr(attrib, buildProxyHref(absolute));
  });

  $('form').each((_, el) => {
    const $form = $(el);
    const originalAction = $form.attr('action') || baseUrl;
    const absoluteAction = resolveAgainst(baseUrl, originalAction);
    if (!absoluteAction) return;

    $form.attr('action', '/saturn/browse');
    if (!$form.attr('method')) {
      $form.attr('method', 'GET');
    }

    $form.find('input[name="__saturn_target"]').remove();
    $form.prepend(`<input type="hidden" name="__saturn_target" value="${absoluteAction.replace(/"/g, '&quot;')}">`);
  });

  $('[srcset]').each((_, el) => {
    const value = $(el).attr('srcset');
    if (!value) return;
    $(el).attr('srcset', rewriteSrcset(value, baseUrl));
  });

  $('meta[http-equiv="refresh"]').each((_, el) => {
    const content = $(el).attr('content');
    if (!content) return;
    const match = content.match(/(\d+\s*;\s*url=)(.*)/i);
    if (!match) return;
    const absolute = resolveAgainst(baseUrl, match[2].trim());
    if (!absolute) return;
    $(el).attr('content', `${match[1]}${buildProxyHref(absolute)}`);
  });

  injectToolbar($, baseUrl);
  return $.html();
}

function stripInternalFields(input) {
  const clone = { ...input };
  delete clone.url;
  delete clone.__saturn_target;
  return clone;
}

function paramsToSearchParams(obj) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(obj)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        params.append(key, item);
      }
    } else if (value !== undefined && value !== null) {
      params.append(key, String(value));
    }
  }
  return params;
}

function copyResponseHeaders(remote, res) {
  const blocked = new Set([
    'content-length',
    'content-encoding',
    'transfer-encoding',
    'connection',
    'keep-alive',
    'content-security-policy',
    'content-security-policy-report-only',
    'x-frame-options',
    'report-to',
    'nel'
  ]);

  for (const [key, value] of remote.headers.entries()) {
    if (!blocked.has(key.toLowerCase())) {
      res.setHeader(key, value);
    }
  }
}

function cookieHeaderForSession(req, targetUrl) {
  const jar = req.session.proxyCookies || {};
  const hostCookies = jar[targetUrl.host] || {};
  const pairs = Object.entries(hostCookies)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
  return pairs;
}

function storeCookiesFromResponse(req, remote, targetUrl) {
  const setCookies = typeof remote.headers.getSetCookie === 'function' ? remote.headers.getSetCookie() : [];
  if (!setCookies.length) return;

  req.session.proxyCookies = req.session.proxyCookies || {};
  req.session.proxyCookies[targetUrl.host] = req.session.proxyCookies[targetUrl.host] || {};

  for (const raw of setCookies) {
    const firstPart = raw.split(';')[0];
    const index = firstPart.indexOf('=');
    if (index === -1) continue;
    const name = firstPart.slice(0, index).trim();
    const value = firstPart.slice(index + 1).trim();
    if (!name) continue;
    req.session.proxyCookies[targetUrl.host][name] = value;
  }
}

async function proxyHandler(req, res) {
  try {
    const rawTarget = req.method === 'GET'
      ? req.query.__saturn_target || req.query.url
      : req.body.__saturn_target || req.query.url;

    const normalized = normalizeUrl(rawTarget);
    if (!normalized) {
      return res.status(400).render('saturn', {
        error: 'That URL is not valid. Try something like https://example.com',
        startUrl: String(rawTarget || ''),
        tips: [
          'Use full domains like google.com or example.com.',
          'Some websites may still block proxying.',
          'Complex sites with heavy JS can break.'
        ]
      });
    }

    const targetUrl = new URL(normalized.href);

    if (req.method === 'GET' && req.query.__saturn_target) {
      const extraParams = stripInternalFields(req.query);
      const searchParams = paramsToSearchParams(extraParams);
      if ([...searchParams.keys()].length > 0) {
        targetUrl.search = searchParams.toString();
      }
    }

    const headers = {
      'user-agent': req.get('user-agent') || 'Mozilla/5.0 SaturnProxy',
      'accept': req.get('accept') || '*/*',
      'accept-language': req.get('accept-language') || 'en-US,en;q=0.9'
    };

    const cookieHeader = cookieHeaderForSession(req, targetUrl);
    if (cookieHeader) {
      headers.cookie = cookieHeader;
    }

    const fetchOptions = {
      method: req.method,
      headers,
      redirect: 'follow'
    };

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const outgoingFields = stripInternalFields(req.body || {});
      fetchOptions.body = paramsToSearchParams(outgoingFields).toString();
      fetchOptions.headers['content-type'] = 'application/x-www-form-urlencoded';
    }

    const remote = await fetch(targetUrl, fetchOptions);
    const finalUrl = new URL(remote.url || targetUrl.href);

    storeCookiesFromResponse(req, remote, finalUrl);
    copyResponseHeaders(remote, res);
    res.status(remote.status);

    const contentType = remote.headers.get('content-type') || '';

    if (contentType.includes('text/html')) {
      const html = await remote.text();
      return res.send(rewriteHtml(html, finalUrl.href));
    }

    if (contentType.includes('text/css')) {
      const css = await remote.text();
      return res.send(rewriteCss(css, finalUrl.href));
    }

    const arrayBuffer = await remote.arrayBuffer();
    return res.send(Buffer.from(arrayBuffer));
  } catch (error) {
    console.error('Proxy error:', error);
    return res.status(500).render('saturn', {
      error: 'Saturn could not load that page. The site may block proxies or the URL might be down.',
      startUrl: req.query.url || req.body?.__saturn_target || '',
      tips: [
        'Try a simpler website first, like example.com.',
        'Some sites block framing, rewriting, or cross-site scripts.',
        'Very dynamic apps may not work perfectly through a lightweight proxy.'
      ]
    });
  }
}

app.get('/', (req, res) => {
  if (req.session.user) {
    return res.redirect('/dashboard');
  }

  res.render('index');
});

app.get('/signup', (req, res) => {
  if (req.session.user) return res.redirect('/dashboard');
  res.render('signup', { error: null, values: {} });
});

app.post('/signup', async (req, res) => {
  const { username, email, password } = req.body;
  const values = { username, email };

  if (!username || !email || !password) {
    return res.status(400).render('signup', { error: 'Fill in every box.', values });
  }

  if (password.length < 6) {
    return res.status(400).render('signup', { error: 'Password must be at least 6 characters.', values });
  }

  const users = await getUsers();
  const existing = users.find((user) => user.email.toLowerCase() === email.toLowerCase());

  if (existing) {
    return res.status(400).render('signup', { error: 'That email is already being used.', values });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const newUser = {
    id: crypto.randomUUID(),
    username: username.trim(),
    email: email.trim().toLowerCase(),
    passwordHash,
    createdAt: new Date().toISOString()
  };

  users.push(newUser);
  await saveUsers(users);

  req.session.user = {
    id: newUser.id,
    username: newUser.username,
    email: newUser.email
  };

  res.redirect('/dashboard');
});

app.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/dashboard');
  res.render('login', { error: null, values: {} });
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const values = { email };

  if (!email || !password) {
    return res.status(400).render('login', { error: 'Enter your email and password.', values });
  }

  const users = await getUsers();
  const user = users.find((entry) => entry.email.toLowerCase() === String(email).toLowerCase());

  if (!user) {
    return res.status(401).render('login', { error: 'Invalid login.', values });
  }

  const matches = await bcrypt.compare(password, user.passwordHash);
  if (!matches) {
    return res.status(401).render('login', { error: 'Invalid login.', values });
  }

  req.session.user = {
    id: user.id,
    username: user.username,
    email: user.email
  };

  res.redirect('/dashboard');
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

app.get('/dashboard', requireAuth, (req, res) => {
  res.render('dashboard');
});

app.get('/plato', requireAuth, (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  const movies = q
    ? MOVIES.filter((movie) => {
        const haystack = `${movie.title} ${movie.genre} ${movie.blurb} ${movie.year}`.toLowerCase();
        return haystack.includes(q);
      })
    : MOVIES;

  res.render('plato', { movies, q });
});

app.get('/saturn', requireAuth, (req, res) => {
  res.render('saturn', {
    error: null,
    startUrl: 'https://example.com',
    tips: [
      'Enter a full URL or just a domain like example.com.',
      'Saturn rewrites links, forms, HTML, CSS, and some cookies.',
      'Heavy sites with advanced scripts may still glitch.'
    ]
  });
});

app.all('/saturn/browse', requireAuth, proxyHandler);

app.use((req, res) => {
  res.status(404).render('not-found');
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
