import { readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

const root = process.cwd();
const weeklyDir = join(root, 'weekly');

const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[character]));

const renderInline = source => {
  const code = [];
  let value = escapeHtml(source).replace(/`([^`]+)`/g, (_, content) => {
    code.push(`<code>${content}</code>`);
    return `\u0000CODE${code.length - 1}\u0000`;
  });
  value = value
    .replace(/!\[([^\]]*)\]\(([^\s)]+)(?:\s+&quot;([^&]*)&quot;)?\)/g, '<img src="$2" alt="$1" loading="lazy">')
    .replace(/\[([^\]]+)\]\(([^\s)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>');
  return value.replace(/\u0000CODE(\d+)\u0000/g, (_, index) => code[Number(index)]);
};

const markdownToHtml = markdown => {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const output = [];
  let paragraph = [];
  let list = null;
  let quote = [];
  let code = null;

  const flushParagraph = () => {
    if (paragraph.length) output.push(`<p>${renderInline(paragraph.join(' '))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (list) output.push(`<${list.type}>${list.items.map(item => `<li>${renderInline(item)}</li>`).join('')}</${list.type}>`);
    list = null;
  };
  const flushQuote = () => {
    if (quote.length) output.push(`<blockquote><p>${renderInline(quote.join(' '))}</p></blockquote>`);
    quote = [];
  };

  for (const line of lines) {
    if (code) {
      if (/^```/.test(line)) {
        output.push(`<pre><code${code.language ? ` class="language-${escapeHtml(code.language)}"` : ''}>${escapeHtml(code.lines.join('\n'))}</code></pre>`);
        code = null;
      } else code.lines.push(line);
      continue;
    }
    const fence = line.match(/^```\s*([\w-]*)/);
    if (fence) {
      flushParagraph(); flushList(); flushQuote();
      code = { language: fence[1], lines: [] };
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushParagraph(); flushList(); flushQuote();
      const level = heading[1].length;
      output.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      continue;
    }
    const item = line.match(/^\s*([-*+] |\d+\. )(.+)$/);
    if (item) {
      flushParagraph(); flushQuote();
      const type = /\d/.test(item[1]) ? 'ol' : 'ul';
      if (list && list.type !== type) flushList();
      if (!list) list = { type, items: [] };
      list.items.push(item[2]);
      continue;
    }
    const quoted = line.match(/^>\s?(.*)$/);
    if (quoted) {
      flushParagraph(); flushList();
      quote.push(quoted[1]);
      continue;
    }
    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) {
      flushParagraph(); flushList(); flushQuote();
      output.push('<hr>');
      continue;
    }
    if (!line.trim()) {
      flushParagraph(); flushList(); flushQuote();
      continue;
    }
    paragraph.push(line.trim());
  }
  if (code) output.push(`<pre><code>${escapeHtml(code.lines.join('\n'))}</code></pre>`);
  flushParagraph(); flushList(); flushQuote();
  return output.join('\n');
};

const parsePost = (entry, source) => {
  if (!entry.source || entry.source !== basename(entry.source)) {
    throw new Error('周记 source 必须是原稿目录中的文件名');
  }
  if (!entry.title || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date || '')) {
    throw new Error(`${entry.source}: title 和 YYYY-MM-DD 格式的 date 为必填项`);
  }
  if (!/^[a-zA-Z0-9-]+$/.test(entry.slug || '')) {
    throw new Error(`${entry.source}: slug 只能包含字母、数字和短横线`);
  }
  return {
    ...entry,
    tags: Array.isArray(entry.tags) ? entry.tags : [],
    body: markdownToHtml(source.trim())
  };
};

const formatDate = date => {
  const [year, month, day] = date.split('-');
  return `${year} 年 ${Number(month)} 月 ${Number(day)} 日`;
};

const sharedStyles = `
    :root{--bg:#f6f4ee;--paper:#fbfaf6;--ink:#222a26;--muted:#727970;--line:#dedfd5;--green:#416853;--green-soft:#e9ede3;--summer:#e8a749}
    *{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.8 system-ui,-apple-system,'PingFang SC',sans-serif}a{color:inherit;text-decoration:none}a:focus-visible{outline:2px solid var(--summer);outline-offset:4px}
    body>header,main,body>footer{max-width:1080px;margin:auto;padding:0 32px}body>header{display:flex;align-items:center;justify-content:space-between;height:100px;border-bottom:1px solid var(--line)}.brand{font-weight:700;letter-spacing:2px}nav{display:flex;gap:30px;font-size:14px}nav a:hover,.active{color:var(--green)}
    .archive-head{padding:80px 0 60px;display:grid;grid-template-columns:1fr auto;align-items:end;gap:40px}.eyebrow{color:var(--green);font-size:12px;letter-spacing:3px;font-weight:600}.archive-head h1{font-family:Georgia,'Songti SC',serif;font-size:clamp(44px,7vw,72px);font-weight:400;line-height:1.15;letter-spacing:-2px;margin:22px 0 14px}.archive-head p{color:var(--muted);max-width:560px;margin:0}.count{font-family:Georgia,serif;font-size:48px;line-height:1;color:var(--green);text-align:right}.count small{display:block;margin-top:9px;font:11px system-ui,sans-serif;letter-spacing:1.5px;color:var(--muted)}
    footer{border-top:1px solid var(--line);padding-top:25px;padding-bottom:35px;display:flex;justify-content:space-between;font-size:12px;color:var(--muted)}.back{display:inline-block;margin:18px 0 75px;color:var(--green);font-size:13px}
    @media(max-width:700px){body>header,main,body>footer{padding-left:22px;padding-right:22px}body>header{height:80px}nav{gap:16px}nav a:nth-child(1),nav a:nth-last-child(-n+2){display:none}.archive-head{padding:54px 0 42px;grid-template-columns:1fr}.count{display:none}body>footer{gap:15px;flex-wrap:wrap}}
    @media(max-width:380px){nav{gap:12px;font-size:13px}.brand{letter-spacing:1px}}
`;

const nav = prefix => `<header><a class="brand" href="${prefix}">L / 学习手记</a><nav aria-label="主要导航"><a href="${prefix}#posts">文章</a><a class="active" href="${prefix}weekly.html" aria-current="page">周记</a><a href="${prefix}movies.html">影视</a><a href="${prefix}following.html">关注</a><a href="${prefix}#about">关于</a><a href="https://github.com/Learners506" target="_blank" rel="noreferrer">GitHub ↗</a></nav></header>`;
const footer = prefix => `<footer><span>© 骨头zzz · 周记</span><a href="${prefix}">返回学习手记首页 ↑</a></footer>`;

const weeklyConfig = JSON.parse(await readFile(join(root, 'data/weekly.json'), 'utf8'));
const sourceDirectory = resolve(root, weeklyConfig.sourceDirectory);
const posts = await Promise.all(weeklyConfig.posts.map(async entry => {
  const source = await readFile(join(sourceDirectory, entry.source), 'utf8');
  return parsePost(entry, source);
}));
posts.sort((a, b) => b.date.localeCompare(a.date));

const listItems = posts.map(post => `<a class="weekly-card" href="weekly/${post.slug}.html"><time datetime="${post.date}">${formatDate(post.date)}</time><h2>${escapeHtml(post.title)}</h2>${post.summary ? `<p>${escapeHtml(post.summary)}</p>` : ''}<span>阅读全文 →</span></a>`).join('\n');
const listPage = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="骨头zzz 的每周记录。"><title>周记 · 骨头zzz</title><style>${sharedStyles}
    .weekly-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin-bottom:70px}.weekly-card{display:flex;min-height:250px;flex-direction:column;padding:32px;background:var(--paper);border:1px solid var(--line);border-radius:5px;transition:transform .2s,border-color .2s}.weekly-card:hover{transform:translateY(-2px);border-color:#aeb7aa}.weekly-card time{font-size:12px;color:var(--green);letter-spacing:1px}.weekly-card h2{font:500 27px/1.5 Georgia,'Songti SC',serif;margin:24px 0 12px}.weekly-card p{color:var(--muted);font-size:14px;margin:0 0 25px}.weekly-card span{margin-top:auto;color:var(--green);font-size:13px}.empty{padding:40px;border:1px dashed var(--line);color:var(--muted)}
    @media(max-width:700px){.weekly-list{grid-template-columns:1fr}.weekly-card{min-height:210px;padding:25px 24px}}
  </style></head><body>${nav('./')}<main><section class="archive-head"><div><div class="eyebrow">WEEKLY · LIFE · NOTES</div><h1>周记</h1><p>把每周做过的事、遇见的问题和零散想法慢慢收集起来。</p></div><div class="count">${String(posts.length).padStart(2, '0')}<small>篇周记</small></div></section><section class="weekly-list">${listItems || '<p class="empty">还没有周记，放入第一篇 Markdown 后再来看看。</p>'}</section><a class="back" href="./">← 返回首页</a></main>${footer('./')}</body></html>`;
await writeFile(join(root, 'weekly.html'), listPage);

for (const post of posts) {
  const tags = post.tags.length ? `<div class="tags">${post.tags.map(tag => `<span>${escapeHtml(tag)}</span>`).join('')}</div>` : '';
  const page = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="${escapeHtml(post.summary || post.title)}"><title>${escapeHtml(post.title)} · 骨头zzz</title><style>${sharedStyles}
    .post-head{max-width:760px;padding:80px 0 45px}.post-head time{color:var(--green);font-size:12px;letter-spacing:1.5px}.post-head h1{font:500 clamp(38px,7vw,62px)/1.25 Georgia,'Songti SC',serif;letter-spacing:-1px;margin:18px 0}.post-head p{color:var(--muted);font-size:16px;max-width:650px}.tags{display:flex;gap:8px;flex-wrap:wrap;margin-top:22px}.tags span{padding:3px 10px;border:1px solid var(--line);border-radius:99px;color:var(--muted);font-size:11px}
    .post-body{max-width:760px;padding:45px 0 65px;border-top:1px solid var(--ink);font-family:Georgia,'Songti SC',serif;font-size:17px;line-height:2.05}.post-body h2,.post-body h3{color:var(--ink);font-weight:500;line-height:1.5;margin:2.2em 0 .7em}.post-body h2{font-size:27px}.post-body h3{font-size:22px}.post-body p{margin:0 0 1.4em}.post-body a{color:var(--green);text-decoration:underline;text-underline-offset:4px}.post-body img{display:block;max-width:100%;height:auto;margin:2em auto;border-radius:4px}.post-body blockquote{margin:2em 0;padding:13px 22px;border-left:3px solid var(--summer);background:var(--paper);color:#59635c}.post-body blockquote p{margin:0}.post-body li{margin:.35em 0}.post-body code{font:14px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--green-soft);padding:2px 6px;border-radius:3px}.post-body pre{overflow:auto;padding:22px;background:#252c28;color:#eef1e9;border-radius:5px;line-height:1.65}.post-body pre code{padding:0;background:none;color:inherit}.post-body hr{border:0;border-top:1px solid var(--line);margin:2.5em 0}
    @media(max-width:700px){.post-head{padding:54px 0 35px}.post-body{padding-top:35px;font-size:16px}}
  </style></head><body>${nav('../')}<main><article><header class="post-head"><time datetime="${post.date}">${formatDate(post.date)}</time><h1>${escapeHtml(post.title)}</h1>${post.summary ? `<p>${escapeHtml(post.summary)}</p>` : ''}${tags}</header><div class="post-body">${post.body}</div></article><a class="back" href="../weekly.html">← 返回全部周记</a></main>${footer('../')}</body></html>`;
  await writeFile(join(weeklyDir, `${post.slug}.html`), page);
}

const indexPath = join(root, 'index.html');
let index = await readFile(indexPath, 'utf8');
const latest = posts[0];
const latestMarkup = latest ? `<section id="weekly" class="section">
      <div class="section-title"><h2><a href="weekly.html">最新周记</a></h2><span>${formatDate(latest.date)}</span></div>
      <a class="weekly-teaser" href="weekly/${latest.slug}.html"><span><span class="tag">一周小记</span><h3>${escapeHtml(latest.title)}</h3>${latest.summary ? `<p>${escapeHtml(latest.summary)}</p>` : ''}</span><span class="weekly-link">打开本周记录 ↗</span></a>
    </section>` : '';
index = index.replace(/<!-- WEEKLY:START -->[\s\S]*?<!-- WEEKLY:END -->/, `<!-- WEEKLY:START -->\n    ${latestMarkup}\n    <!-- WEEKLY:END -->`);
await writeFile(indexPath, index);

console.log(`已生成 ${posts.length} 篇周记和周记目录。`);
