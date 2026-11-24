// Embedded Edge TTS client (no Python or external edge-tts binary required).
// Protocol compatible with edge-tts 7.3.x (Sec-MS-GEC v2 token).

import https from "https";
import { randomBytes } from "crypto";
import WebSocket from "ws";

const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const SEC_MS_GEC_VERSION = '2-143.0.3650.75';
const WSS_URL =
  'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1';

const U32 = 0xffffffffn;
const m = (x) => BigInt(x) & U32;
const rol16 = (v) => { v = m(v); return ((v << 16n) | (v >> 16n)) & U32; };
const wordsLE4Even = (buf) => {
  const pad = (4 - (buf.length % 4)) % 4;
  const b = Buffer.concat([buf, Buffer.alloc(pad)]);
  const words = [];
  for (let i = 0; i < b.length; i += 4) words.push(m(b.readUInt32LE(i)));
  if (words.length % 2) words.push(0n);
  return words;
};
const sigma0 = (v) => (((v >> 7n) ^ (v << 25n) ^ (v >> 18n) ^ (v << 14n) ^ (v >> 3n)) & U32);
const sigma1 = (v) => (((v >> 17n) ^ (v << 15n) ^ (v >> 19n) ^ (v << 13n) ^ (v >> 10n)) & U32);
const K = [0x428A2F98,0x71374491,0xB5C0FBCF,0xE9B5DBA5,0x3956C25B,0x59F111F1,0x923F82A4,0xAB1C5ED5,0xD807AA98,0x12835B01,0x243185BE,0x550C7DC3,0x72BE5D74,0x80DEB1FE,0x9BDC06A7,0xC19BF174,0xE49B69C1,0xEFBE4786,0x0FC19DC6,0x240CA1CC,0x2DE92C6F,0x4A7484AA,0x5CB0A9DC,0x76F988DA,0x983E5152,0xA831C66D,0xB00327C8,0xBF597FC7,0xC6E00BF3,0xD5A79147,0x06CA6351,0x14292967,0x27B70A85,0x2E1B2138,0x4D2C6DFC,0x53380D13,0x650A7354,0x766A0ABB,0x81C2C92E,0x92722C85,0xA2BFE8A1,0xA81A664B,0xC24B8B70,0xC76C51A3,0xD192E819,0xD6990624,0xF40E3585,0x106AA070,0x19A4C116,0x1E376C08,0x2748774C,0x34B0BCB5,0x391C0CB3,0x4ED8AA4A,0x5B9CCA4F,0x682E6FF3,0x748F82EE,0x78A5636F,0x84C87814,0x8CC70208,0x90BEFFFA,0xA4506CEB,0xBEF9A3F7,0xC67178F2].map(BigInt);
const KB = [...K.slice(0,14), 0xC9DC06A7n, ...K.slice(15)];
const INIT = [0x6A09E667,0xBB67AE85,0x3C6EF372,0xA54FF53A,0x510E527F,0x9B05688C,0x1F83D9AB,0x5BE0CD19].map(BigInt);
const STATE = [0xFD9FBEA2,0x91243CE7,0xBE499094,0xCD2E1E0A,0x6C006F49,0x04BD35AB,0xFEB0A7E4,0x03EFFBD2].map(BigInt);
const SCHED = [0xEB24BF9E,0x1558691F,0xA0C09EE2,0x0CFA32BA,0xA622EE8C,0xD1DD9491,0xC0DD25A0,0xF9E70AB6,0xF0C31573,0x7058CE4E,0x7188E606,0x00E5AB33,0xD258B060,0x72766564].map(BigInt);
function rounds(state, words, first = 0) {
  let [a,b,c,d,e,f,g,h] = state;
  const constants = first === 14 ? KB : K;
  const aligned = Math.min(64, Math.ceil((first + 1) / 8) * 8);
  for (let i = first; i < aligned; i++) {
    const re = e * 0x100000001n, ra = a * 0x100000001n;
    const t1 = (h + ((re>>6n)^(re>>11n)^(re>>25n)) + (g ^ (e & (f^g))) + constants[i] + words[i]) & U32;
    const t2 = (((ra>>2n)^(ra>>13n)^(ra>>22n)) + ((a&b)|(c&(a|b)))) & U32;
    [a,b,c,d,e,f,g,h] = [m(t1+t2),a,b,c,m(d+t1),e,f,g];
  }
  for (let i = aligned; i < 64; i += 8) {
    let re=e*0x100000001n, ra=a*0x100000001n;
    let t1=(h+((re>>6n)^(re>>11n)^(re>>25n))+(g^(e&(f^g)))+constants[i]+words[i])&U32;
    d=m(d+t1);
    h=m(t1+((ra>>2n)^(ra>>13n)^(ra>>22n))+((a&b)|(c&(a|b))));
    re=d*0x100000001n; ra=h*0x100000001n;
    t1=(g+((re>>6n)^(re>>11n)^(re>>25n))+(f^(d&(e^f)))+constants[i+1]+words[i+1])&U32;
    c=m(c+t1);
    g=m(t1+((ra>>2n)^(ra>>13n)^(ra>>22n))+((h&a)|(b&(h|a))));
    re=c*0x100000001n; ra=g*0x100000001n;
    t1=(f+((re>>6n)^(re>>11n)^(re>>25n))+(e^(c&(d^e)))+constants[i+2]+words[i+2])&U32;
    b=m(b+t1);
    f=m(t1+((ra>>2n)^(ra>>13n)^(ra>>22n))+((g&h)|(a&(g|h))));
    re=b*0x100000001n; ra=f*0x100000001n;
    t1=(e+((re>>6n)^(re>>11n)^(re>>25n))+(d^(b&(c^d)))+constants[i+3]+words[i+3])&U32;
    a=m(a+t1);
    e=m(t1+((ra>>2n)^(ra>>13n)^(ra>>22n))+((f&g)|(h&(f|g))));
    re=a*0x100000001n; ra=e*0x100000001n;
    t1=(d+((re>>6n)^(re>>11n)^(re>>25n))+(c^(a&(b^c)))+constants[i+4]+words[i+4])&U32;
    h=m(h+t1);
    d=m(t1+((ra>>2n)^(ra>>13n)^(ra>>22n))+((e&f)|(g&(e|f))));
    re=h*0x100000001n; ra=d*0x100000001n;
    t1=(c+((re>>6n)^(re>>11n)^(re>>25n))+(b^(h&(a^b)))+constants[i+5]+words[i+5])&U32;
    g=m(g+t1);
    c=m(t1+((ra>>2n)^(ra>>13n)^(ra>>22n))+((d&e)|(f&(d|e))));
    re=g*0x100000001n; ra=c*0x100000001n;
    t1=(b+((re>>6n)^(re>>11n)^(re>>25n))+(a^(g&(h^a)))+constants[i+6]+words[i+6])&U32;
    f=m(f+t1);
    b=m(t1+((ra>>2n)^(ra>>13n)^(ra>>22n))+((c&d)|(e&(c|d))));
    re=f*0x100000001n; ra=b*0x100000001n;
    t1=(a+((re>>6n)^(re>>11n)^(re>>25n))+(h^(f&(g^h)))+constants[i+7]+words[i+7])&U32;
    e=m(e+t1);
    a=m(t1+((ra>>2n)^(ra>>13n)^(ra>>22n))+((b&c)|(d&(b|c))));
  }
  return [a,b,c,d,e,f,g,h];
}
function expand(words, first = 16) {
  for (let i = first; i < 64; i++) {
    const x=words[i-2], y=words[i-15];
    const s1=((x>>17n)^(x<<15n)^(x>>19n)^(x<<13n)^(x>>10n));
    const s0=((y>>7n)^(y<<25n)^(y>>18n)^(y<<14n)^(y>>3n));
    words.push(m(s1+words[i-7]+s0+words[i-16]));
  }
}
function shaInit(data) {
  const words = Array(14).fill(0n);
  words.push(m(BigInt('0x'+data.subarray(0,3).toString('hex'))));
  words.push(m(BigInt('0x'+data.subarray(3,7).toString('hex'))));
  for (let i=16;i<30;i++) {
    let v=SCHED[i-16];
    if (i-2>=14) v += i===16 ? (sigma1(words[i-2]) ^ 0x000B92C0n) : sigma1(words[i-2]);
    if (i-7>=14) v += words[i-7];
    if (i-15>=14) v += i===29 ? (sigma0(words[i-15]) ^ 0x059C0B80n) : sigma0(words[i-15]);
    words.push(m(v));
  }
  words.push(m(sigma1(words[28])+words[23]+sigma0(words[15])+words[14]+0xC9DC06A7n-K[14]));
  expand(words,31);
  const working = rounds(STATE, words, 14);
  return INIT.map((x,i)=>m(x+working[i]));
}
function shaDigest(data) {
  const length = 57 + data.length;
  let padded = Buffer.concat([data.subarray(7), Buffer.from([0x80]), Buffer.alloc(((55-length)%64+64)%64)]);
  const lenBuf = Buffer.alloc(8); lenBuf.writeBigUInt64BE(BigInt(length*8));
  padded = Buffer.concat([padded,lenBuf]);
  let state = shaInit(data.subarray(0,7));
  for (let off=0; off<padded.length; off+=64) {
    const block=padded.subarray(off,off+64); const words=[];
    for (let i=0;i<64;i+=4) words.push(m(block.readUInt32BE(i)));
    expand(words);
    const w=rounds(state,words);
    state=state.map((x,i)=>m(x+w[i]));
  }
  const out=Buffer.alloc(32); state.forEach((x,i)=>out.writeUInt32BE(Number(x),i*4));
  return out;
}
const COEF = [[0xE82E91B1,0xB32700D0],[0x44DE24C6,0x88DFF51D],[0x3BEB65BC,0x29514038],[0xC89C5933,0xB328CBDF],[0x8D1EC211,0xD405B4D5],[0x314EF5D5,0x26E55F3C],[0xE92491B1,0x607801C6],[0xF0A5B9D5,0x82B2C1FB],[0x06064CF3,0xFA51A3DA],[0xDA79FA60,0x207CC464],[0xBED20560,0x3C3C74F3],[0x89F9C9F8,0xD2D14B61],[0x35FA38C6,0xBB04A2C1],[0xCB49E3C6,0xC5626167]].map(([a,b])=>[BigInt(a),BigInt(b)]);
function cs64(data, digest) {
  let ka=m(BigInt(digest.readUInt32LE(0))|1n), kb=m(BigInt(digest.readUInt32LE(4))|1n);
  const fa=m(ka*0x82893933n), fb=m(kb*0x82893933n);
  const terms=COEF.map(([c],i)=>m(c*(i%2?fb:fa)));
  const offsets=COEF.map(([,o])=>BigInt(o));
  const words=wordsLE4Even(Buffer.concat([Buffer.from([0]),data]));
  words.forEach((word,index)=>{
    let term=m(word*(index%2?kb:ka));
    let off=m(rol16(word)*(index%2?0xC31713DBn:0xEF0569FBn));
    if(index===0){ term=m(term+0xF2F90B1An*fa); off=m(off+0x0B1A0000n); }
    terms.push(term); offsets.push(off);
  });
  let swapAcc=0n,swapLast=0n,state=0n,acc=0n;
  for(let i=0;i<terms.length;i+=2){
    const x=terms[i],y=terms[i+1];
    let t=rol16(m(offsets[i]+x)), q=m(t*0x76F50F34n);
    swapAcc=m(swapAcc+m(m(rol16(q)*0xC3EFEA97n)+q));
    t=rol16(m(offsets[i+1]+y)); q=m(t*0x1881CE3Cn);
    swapLast=m(m(rol16(q)*0x35BD1EC9n)+q);
    swapAcc=m(swapAcc+swapLast);
    state=m(state*ka+x); state=m(rol16(state)*0xCF98B111n); state=m(rol16(state)*0x87085B9Fn); state=m(rol16(state)*0x12CEB96Dn); state=m(rol16(state)*0x257E1D83n);
    acc=m(acc+state);
    t=m(state*kb+y); t=m(rol16(t)*0xA27416F5n); t=m(rol16(t)*0xD38396FFn);
    state=m(m(rol16(m(rol16(t)*0x7C932B89n))*0xBFA49F69n));
    acc=m(acc+state);
  }
  return [swapLast^state, swapAcc^acc];
}
function token(unix) {
  let ticks = unix + 11644473600;
  ticks -= ticks % 300;
  ticks *= 1e7;
  const str=BigInt(Math.round(ticks)).toString()+'6A5AA1D4EAFF4E9FB37E23D68491D6F4';
  const data=Buffer.from(str,'ascii'); const digest=shaDigest(data);
  const [a,b]=cs64(data,digest);
  const partA=Buffer.alloc(8); partA.writeUInt32LE(Number(a),0); partA.writeUInt32LE(Number(b),4);
  return partA.toString('hex').toUpperCase()+'-'+digest.toString('hex').toUpperCase();
}
function generateSecMsGec(skewSeconds = 0, nowMs = Date.now()) {
  return token(nowMs / 1000 + skewSeconds);
}

// Locale -> neural voice map. Freely editable, no online voice-list dependency.
const VOICE_MAP = {
  'pt-br': 'pt-BR-FranciscaNeural',
  'pt-pt': 'pt-PT-RaquelNeural',
  pt: 'pt-BR-FranciscaNeural',
  'en-us': 'en-US-EmmaMultilingualNeural',
  'en-gb': 'en-GB-SoniaNeural',
  en: 'en-US-EmmaMultilingualNeural',
  'es-es': 'es-ES-ElviraNeural',
  'es-mx': 'es-MX-DaliaNeural',
  es: 'es-ES-ElviraNeural',
  'fr-fr': 'fr-FR-DeniseNeural',
  fr: 'fr-FR-DeniseNeural',
  'de-de': 'de-DE-KatjaNeural',
  de: 'de-DE-KatjaNeural',
  'it-it': 'it-IT-ElsaNeural',
  it: 'it-IT-ElsaNeural',
  'ru-ru': 'ru-RU-SvetlanaNeural',
  ru: 'ru-RU-SvetlanaNeural',
  'ja-jp': 'ja-JP-NanamiNeural',
  ja: 'ja-JP-NanamiNeural',
  'ko-kr': 'ko-KR-SunHiNeural',
  ko: 'ko-KR-SunHiNeural',
  'zh-cn': 'zh-CN-XiaoxiaoNeural',
  'zh-tw': 'zh-TW-HsiaoChenNeural',
  zh: 'zh-CN-XiaoxiaoNeural',
  'nl-nl': 'nl-NL-ColetteNeural',
  nl: 'nl-NL-ColetteNeural',
  'pl-pl': 'pl-PL-ZofiaNeural',
  pl: 'pl-PL-ZofiaNeural',
  'tr-tr': 'tr-TR-EmelNeural',
  tr: 'tr-TR-EmelNeural',
  'ar-sa': 'ar-SA-ZariyahNeural',
  ar: 'ar-SA-ZariyahNeural',
  'hi-in': 'hi-IN-SwaraNeural',
  hi: 'hi-IN-SwaraNeural',
  'id-id': 'id-ID-GadisNeural',
  id: 'id-ID-GadisNeural',
  'uk-ua': 'uk-UA-PolinaNeural',
  uk: 'uk-UA-PolinaNeural',
  'cs-cz': 'cs-CZ-AnastazieNeural',
  cs: 'cs-CZ-AnastazieNeural',
  'sv-se': 'sv-SE-SofieNeural',
  sv: 'sv-SE-SofieNeural',
  'da-dk': 'da-DK-ChristelNeural',
  da: 'da-DK-ChristelNeural',
  'nb-no': 'nb-NO-IselinNeural',
  no: 'nb-NO-IselinNeural',
  'fi-fi': 'fi-FI-NooraNeural',
  fi: 'fi-FI-NooraNeural',
  'el-gr': 'el-GR-AthinaNeural',
  el: 'el-GR-AthinaNeural',
  'he-il': 'he-IL-HilaNeural',
  he: 'he-IL-HilaNeural',
  'th-th': 'th-TH-PremwadeeNeural',
  th: 'th-TH-PremwadeeNeural',
  'vi-vn': 'vi-VN-HoaiMyNeural',
  vi: 'vi-VN-HoaiMyNeural',
  'ro-ro': 'ro-RO-AlinaNeural',
  ro: 'ro-RO-AlinaNeural',
  'hu-hu': 'hu-HU-NoemiNeural',
  hu: 'hu-HU-NoemiNeural',
  'ca-es': 'ca-ES-ElviraNeural',
  ca: 'ca-ES-ElviraNeural',
};

function normalizeLocale(locale) {
  if (!locale) return '';
  return String(locale)
    .trim()
    .toLowerCase()
    .replace(/_/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

function resolveVoiceForLocale(locale, fallback = 'pt-BR-FranciscaNeural') {
  const full = normalizeLocale(locale);
  const base = full.split('-')[0];
  return VOICE_MAP[full] || VOICE_MAP[base] || fallback;
}

function xmlEscape(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Divide em blocos pequenos respeitando UTF-8 e limites de palavra.
function splitText(text, maxBytes = 3800) {
  const chunks = [];
  let rest = Buffer.from(String(text), 'utf8');
  while (rest.length > maxBytes) {
    let at = rest.lastIndexOf(0x20, maxBytes);
    if (at < 1) {
      at = maxBytes;
      while (at > 0 && (rest[at] & 0xc0) === 0x80) at--;
    }
    const piece = rest.subarray(0, at).toString('utf8').trim();
    if (piece) chunks.push(piece);
    rest = rest.subarray(at);
    while (rest.length && rest[0] === 0x20) rest = rest.subarray(1);
  }
  if (rest.length) chunks.push(rest.toString('utf8').trim());
  return chunks.filter(Boolean);
}

// Mesmo formato de edge-tts (date_to_string): "Tue Nov 24 2026 12:34:56 GMT+0000 ..."
function jsDateString() {
  const d = new Date();
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const p = (n) => String(n).padStart(2, '0');
  return (
    `${days[d.getUTCDay()]} ${months[d.getUTCMonth()]} ${p(d.getUTCDate())} ` +
    `${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} ` +
    'GMT+0000 (Coordinated Universal Time)'
  );
}

function buildSsml(text, voice, rate, pitch) {
  return (
    `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>` +
    `<voice name='${voice}'>` +
    `<prosody pitch='${pitch}' rate='${rate}' volume='+0%'>${xmlEscape(text)}</prosody>` +
    `</voice></speak>`
  );
}

function parseFrame(raw, isBinary) {
  if (isBinary) {
    const buf = Buffer.from(raw);
    if (buf.length < 2) return null;
    const headerLength = buf.readUInt16BE(0);
    if (headerLength + 2 > buf.length) return null;
    const headerText = buf.subarray(2, headerLength + 2).toString('utf8');
    const data = buf.subarray(headerLength + 2);
    const headers = {};
    headerText.split('\r\n').forEach((line) => {
      const idx = line.indexOf(':');
      if (idx > 0) headers[line.slice(0, idx)] = line.slice(idx + 1).trim();
    });
    return { headers, data };
  }
  const text = String(raw);
  const cut = text.indexOf('\r\n\r\n');
  if (cut < 0) return null;
  const headers = {};
  text.slice(0, cut).split('\r\n').forEach((line) => {
    const idx = line.indexOf(':');
    if (idx > 0) headers[line.slice(0, idx)] = line.slice(idx + 1).trim();
  });
  return { headers, data: Buffer.from(text.slice(cut + 4), 'utf8') };
}

function getServerDateSkew() {
  return new Promise((resolve) => {
    const req = https.get(
      'https://speech.platform.bing.com/',
      { timeout: 6000 },
      (res) => {
        const date = res.headers.date;
        res.resume();
        const parsed = date ? Date.parse(date) : NaN;
        resolve(Number.isFinite(parsed) ? (parsed - Date.now()) / 1000 : 0);
      }
    );
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(0));
  });
}

async function synthesizeOnce({ text, voice, rate, pitch, skew, timeoutMs }) {
  if (typeof WebSocket !== 'function') {
    throw new Error('WebSocket unavailable in this Electron version');
  }
  const connectionId = randomBytes(16).toString('hex');
  const url =
    `${WSS_URL}?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}` +
    `&ConnectionId=${connectionId}` +
    `&Sec-MS-GEC=${generateSecMsGec(skew)}` +
    `&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}`;

  const ws = new WebSocket(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0',
      'Accept-Encoding': 'gzip, deflate, br',
      'Accept-Language': 'en-US,en;q=0.9',
      Pragma: 'no-cache',
      'Cache-Control': 'no-cache',
      Origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
      // Nunca definir Sec-WebSocket-Version manualmente: o WebSocket nativo
      // Node/Electron already sends this header; duplicating it breaks the
      // handshake (a "TTS WebSocket error" right when testing a voice).
      Cookie: `muid=${randomBytes(16).toString('hex').toUpperCase()};`,
    },
  });
  ws.binaryType = 'arraybuffer';

  return new Promise((resolve, reject) => {
    let settled = false;
    let turnEnd = false;
    const audio = [];
    const timer = setTimeout(() => finish(new Error('TTS timeout')), timeoutMs);

    function finish(error, buffer) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch (_) {}
      if (error) reject(error);
      else resolve(buffer);
    }

    ws.onopen = () => {
      const config =
        `X-Timestamp:${jsDateString()}\r\n` +
        'Content-Type:application/json; charset=utf-8\r\n' +
        'Path:speech.config\r\n\r\n' +
        '{"context":{"synthesis":{"audio":{"metadataoptions":{' +
        '"sentenceBoundaryEnabled":"true","wordBoundaryEnabled":"false"' +
        '},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n';
      try { ws.send(config); } catch (e) { return finish(e); }

      for (const chunk of splitText(text)) {
        const ssml = buildSsml(chunk, voice, rate, pitch);
        const msg =
          `X-RequestId:${randomBytes(16).toString('hex')}\r\n` +
          'Content-Type:application/ssml+xml\r\n' +
          `X-Timestamp:${jsDateString()}Z\r\n` +
          'Path:ssml\r\n\r\n' +
          ssml;
        try { ws.send(msg); } catch (e) { return finish(e); }
      }
    };

    ws.onmessage = (event) => {
      const frame = parseFrame(event.data, typeof event.data !== 'string');
      if (!frame) return;
      const path = frame.headers.Path || frame.headers.path;
      if (path === 'audio' && frame.data.length) {
        audio.push(frame.data);
      } else if (path === 'turn.end') {
        turnEnd = true;
        finish(null, Buffer.concat(audio));
      }
    };

    ws.onerror = (event) => {
      const inner = event?.error;
      const message =
        event?.message ||
        inner?.message ||
        (inner?.stack ? String(inner.stack).split('\n')[0] : '') ||
        'TTS WebSocket error';
      finish(new Error(String(message)));
    };

    ws.onclose = () => {
      if (audio.length && !settled) finish(null, Buffer.concat(audio));
      else if (!settled) finish(new Error('TTS connection closed without audio'));
    };
  });
}

async function synthesizeEdgeTts({ text, voice, rate = '+0%', pitch = '+0Hz', timeoutMs = 30000 } = {}) {
  try {
    return await synthesizeOnce({ text, voice, rate, pitch, skew: 0, timeoutMs });
  } catch (firstError) {
    // A common failure is a local clock outside the server's five-minute
    // window (Sec-MS-GEC token). Node's WebSocket error does not expose the
    // HTTP status, so retry with the server's date skew.
    const skew = await getServerDateSkew();
    if (!skew) throw firstError;
    try {
      return await synthesizeOnce({ text, voice, rate, pitch, skew, timeoutMs });
    } catch (_) {
      throw firstError;
    }
  }
}

export {
  synthesizeEdgeTts,
  resolveVoiceForLocale,
  normalizeLocale,
  generateSecMsGec,
  VOICE_MAP,
};
