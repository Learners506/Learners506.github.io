import { readFile, writeFile } from 'node:fs/promises';

const periodDays = 7;
const outputPath = new URL('../data/following.json', import.meta.url);
const blogs = [
  {
    name: '潮流周刊',
    url: 'https://weekly.tw93.fun/',
    feed: 'https://weekly.tw93.fun/rss.xml'
  },
  {
    name: '阮一峰的网络日志',
    url: 'https://www.ruanyifeng.com/blog/index.html',
    feed: 'https://www.ruanyifeng.com/blog/atom.xml'
  }
];

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const fetchFeed = async blog => {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(blog.feed, { headers: { 'user-agent': 'gutouzzz-blog-feed-reader/1.0' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < 3) await wait(attempt * 1500);
    }
  }
  throw new Error(`Unable to fetch ${blog.name} after 3 attempts: ${lastError.message}`);
};

const decodeXml = value => value
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/<[^>]+>/g, '')
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#39;|&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
  .trim();

const tagValue = (block, names) => {
  for (const name of names) {
    const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'));
    if (match) return decodeXml(match[1]);
  }
  return '';
};

const entryLink = (block, base) => {
  const atom = block.match(/<link\b(?=[^>]*rel=["']alternate["'])[^>]*href=["']([^"']+)["'][^>]*>/i)
    || block.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*>/i);
  const rss = tagValue(block, ['link']);
  const value = atom?.[1] || rss;
  if (!value) return '';
  const url = new URL(value, base);
  if (url.protocol === 'http:' && new URL(base).protocol === 'https:') url.protocol = 'https:';
  return url.href;
};

const parseFeed = (xml, blog) => {
  const blocks = [...xml.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map(match => match[2]);
  return blocks.map(block => ({
    blog: blog.name,
    title: tagValue(block, ['title']),
    url: entryLink(block, blog.feed),
    published: tagValue(block, ['pubDate', 'published', 'updated', 'dc:date'])
  })).filter(item => item.title && item.url && !Number.isNaN(Date.parse(item.published)));
};

let previous;
try { previous = JSON.parse(await readFile(outputPath, 'utf8')); } catch {}

const now = Date.now();
const cutoff = now - periodDays * 24 * 60 * 60 * 1000;
const collected = [];

for (const blog of blogs) {
  try {
    collected.push(...parseFeed(await fetchFeed(blog), blog));
  } catch (error) {
    console.warn(`${error.message}; keeping previously fetched articles for this source.`);
    collected.push(...(previous?.items || []).filter(item => item.blog === blog.name));
  }
}

const items = collected
  .filter(item => {
    const published = Date.parse(item.published);
    return published >= cutoff && published <= now + 5 * 60 * 1000;
  })
  .sort((a, b) => Date.parse(b.published) - Date.parse(a.published))
  .filter((item, index, all) => all.findIndex(candidate => candidate.url === item.url) === index);

const publicBlogs = blogs.map(({ name, url }) => ({ name, url }));
const contentChanged = JSON.stringify(previous?.blogs) !== JSON.stringify(publicBlogs)
  || JSON.stringify(previous?.items) !== JSON.stringify(items)
  || previous?.periodDays !== periodDays;

if (contentChanged) {
  await writeFile(outputPath, `${JSON.stringify({ updatedAt: new Date().toISOString(), periodDays, blogs: publicBlogs, items }, null, 2)}\n`);
  console.log(`Updated ${items.length} recent article(s).`);
} else {
  console.log(`No changes; ${items.length} recent article(s) remain current.`);
}
