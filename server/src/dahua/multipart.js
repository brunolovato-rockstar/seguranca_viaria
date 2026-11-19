// Parser incremental de multipart/x-mixed-replace (fluxo de eventos e MJPEG da câmera).
import { EventEmitter } from 'node:events';

export class MultipartParser extends EventEmitter {
  constructor(boundary) {
    super();
    this.b = Buffer.from('--' + boundary.replace(/^--/, ''));
    this.buf = Buffer.alloc(0);
  }

  feed(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    // proteção: descarta lixo acumulado sem boundary
    if (this.buf.length > 64 * 1024 * 1024) this.buf = this.buf.subarray(-1024 * 1024);
    for (;;) {
      const start = this.buf.indexOf(this.b);
      if (start < 0) return;
      const hdrEnd = this.buf.indexOf('\r\n\r\n', start);
      if (hdrEnd < 0) return;
      const headerText = this.buf.subarray(start + this.b.length, hdrEnd).toString('latin1');
      const headers = {};
      for (const line of headerText.split(/\r?\n/)) {
        const i = line.indexOf(':');
        if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
      }
      const bodyStart = hdrEnd + 4;
      const len = Number(headers['content-length']);
      let body;
      let next;
      if (Number.isFinite(len) && len >= 0) {
        if (this.buf.length < bodyStart + len) return;
        body = this.buf.subarray(bodyStart, bodyStart + len);
        next = bodyStart + len;
      } else {
        const nb = this.buf.indexOf(this.b, bodyStart);
        if (nb < 0) return;
        let end = nb;
        if (this.buf[end - 2] === 13 && this.buf[end - 1] === 10) end -= 2;
        body = this.buf.subarray(bodyStart, end);
        next = nb;
      }
      this.buf = this.buf.subarray(next);
      this.emit('part', { headers, body: Buffer.from(body) });
    }
  }
}

export function boundaryFrom(contentType = '') {
  const m = /boundary="?([^";]+)"?/i.exec(contentType);
  return m ? m[1] : 'myboundary';
}
