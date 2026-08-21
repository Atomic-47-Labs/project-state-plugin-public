// ---------------------------------------------------------------------------
// Minimal YAML reader — scoped to the shapes the project-state substrate writes.
// Zero dependencies by design: the generator must run anywhere `node` runs,
// with no install step, on a machine that may hold SR&ED records.
//
// Supported: block maps, block sequences (scalars + inline-first-key maps),
// block scalars (| |- |+ > >-), flow sequences/maps, quoted + plain scalars,
// `~`/`null`, booleans, numbers, `#` comments (line and trailing).
// Not supported (and not used by the substrate): anchors, aliases, tags,
// multi-document streams, complex keys.
// ---------------------------------------------------------------------------

function stripComment(s) {
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'") { q = c; continue; }
    if (c === '#' && (i === 0 || /\s/.test(s[i - 1]))) return s.slice(0, i);
  }
  return s;
}

function splitFlow(body) {
  const out = [];
  let depth = 0, q = null, cur = '';
  for (const c of body) {
    if (q) {
      cur += c;
      if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === '[' || c === '{') { depth++; cur += c; continue; }
    if (c === ']' || c === '}') { depth--; cur += c; continue; }
    if (c === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim() !== '') out.push(cur);
  return out.map((x) => x.trim());
}

function unquote(s) {
  if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') {
    return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\t/g, '\t')
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  }
  if (s.length >= 2 && s[0] === "'" && s[s.length - 1] === "'") {
    return s.slice(1, -1).replace(/''/g, "'");
  }
  return s;
}

function parseScalar(raw) {
  const s = raw.trim();
  if (s === '' || s === '~' || s === 'null' || s === 'Null' || s === 'NULL') return null;
  if (s === 'true' || s === 'True' || s === 'yes') return true;
  if (s === 'false' || s === 'False' || s === 'no') return false;
  if (s[0] === '[' && s[s.length - 1] === ']') {
    return splitFlow(s.slice(1, -1)).map(parseScalar);
  }
  if (s[0] === '{' && s[s.length - 1] === '}') {
    const obj = {};
    for (const part of splitFlow(s.slice(1, -1))) {
      const m = part.match(/^([^:]+):\s*([\s\S]*)$/);
      if (m) obj[unquote(m[1].trim())] = parseScalar(m[2]);
    }
    return obj;
  }
  if ((s[0] === '"' && s[s.length - 1] === '"') || (s[0] === "'" && s[s.length - 1] === "'")) {
    return unquote(s);
  }
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  if (/^-?\d*\.\d+$/.test(s)) return parseFloat(s);
  return s;
}

export function parseYaml(text) {
  const L = String(text).replace(/^﻿/, '').split(/\r?\n/);
  let i = 0;

  const skippable = (idx) => idx < L.length && (/^\s*$/.test(L[idx]) || /^\s*#/.test(L[idx]));
  const indentOf = (idx) => L[idx].match(/^(\s*)/)[1].length;
  const skip = () => { while (i < L.length && skippable(i)) i++; };

  function blockScalar(header, parentIndent) {
    const chomp = /-/.test(header) ? 'strip' : /\+/.test(header) ? 'keep' : 'clip';
    const fold = header[0] === '>';
    const buf = [];
    let base = null;
    while (i < L.length) {
      if (/^\s*$/.test(L[i])) { buf.push(''); i++; continue; }
      const ind = indentOf(i);
      if (ind <= parentIndent) break;
      if (base === null) base = ind;
      buf.push(L[i].slice(Math.min(base, ind)));
      i++;
    }
    while (buf.length && buf[buf.length - 1] === '') buf.pop();
    let out;
    if (fold) {
      const paras = [];
      let run = [];
      for (const line of buf) {
        if (line === '') { paras.push(run.join(' ')); run = []; }
        else if (/^\s/.test(line)) { paras.push(run.join(' ')); run = []; paras.push(line); }
        else run.push(line.trim());
      }
      paras.push(run.join(' '));
      out = paras.filter((p, n, a) => !(p === '' && n === a.length - 1)).join('\n');
    } else {
      out = buf.join('\n');
    }
    if (chomp === 'strip') out = out.replace(/\n+$/, '');
    else if (chomp === 'clip') out = out.replace(/\n+$/, '') + '\n';
    return out;
  }

  function parseNode(minIndent) {
    skip();
    if (i >= L.length) return null;
    const ind = indentOf(i);
    if (ind < minIndent) return null;
    const body = L[i].slice(ind);
    return /^-(\s|$)/.test(body) ? parseSeq(ind) : parseMap(ind);
  }

  function parseMap(myIndent) {
    const obj = {};
    for (;;) {
      skip();
      if (i >= L.length) break;
      const ind = indentOf(i);
      if (ind < myIndent) break;
      const body = L[i].slice(ind);
      if (/^-(\s|$)/.test(body)) break;
      const m = body.match(/^((?:"[^"]*"|'[^']*'|[^:])+?)\s*:\s*([\s\S]*)$/);
      if (!m) { i++; continue; }
      const key = unquote(m[1].trim());
      let val = m[2];
      const bs = val.match(/^([|>][-+]?\d*)\s*$/);
      if (bs) {
        i++;
        obj[key] = blockScalar(bs[1], ind);
        continue;
      }
      val = stripComment(val).trim();
      if (val === '') {
        i++;
        const child = parseNode(ind + 1);
        obj[key] = child === null ? null : child;
        continue;
      }
      obj[key] = parseScalar(val);
      i++;
    }
    return obj;
  }

  function parseSeq(myIndent) {
    const arr = [];
    for (;;) {
      skip();
      if (i >= L.length) break;
      const ind = indentOf(i);
      if (ind !== myIndent) break;
      const body = L[i].slice(ind);
      if (!/^-(\s|$)/.test(body)) break;
      const rest = body.slice(1).replace(/^\s+/, '');
      const restCol = ind + (body.length - rest.length);
      if (rest === '') {
        i++;
        arr.push(parseNode(myIndent + 1));
        continue;
      }
      const looksLikeMap = !/^[[{"']/.test(rest) &&
        /^((?:[^:])+?)\s*:(\s|$)/.test(stripComment(rest));
      if (looksLikeMap) {
        L[i] = ' '.repeat(restCol) + rest;   // rewrite "- k: v" as "  k: v"
        arr.push(parseMap(restCol));
        continue;
      }
      arr.push(parseScalar(stripComment(rest)));
      i++;
    }
    return arr;
  }

  const doc = parseNode(0);
  return doc === null ? {} : doc;
}
