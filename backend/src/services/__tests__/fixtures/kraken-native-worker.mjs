import { createInterface } from 'node:readline';
import { closeSync } from 'node:fs';

const protocol = 'kraken-native-layout-ndjson';
let requestNumber = 0;

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

send({
  type: 'ready',
  protocol,
  version: 1,
  model: { name: 'fixture' },
});

const lines = createInterface({ input: process.stdin });
lines.on('line', (line) => {
  const request = JSON.parse(line);
  if (request.type === 'shutdown') {
    send({
      type: 'stopped',
      id: request.id,
      protocol,
      version: 1,
    });
    lines.close();
    return;
  }
  requestNumber += 1;
  if (request.imagePath === 'close-stdin') {
    // Simulate a live Python process whose stdin pipe disappeared (for
    // example, during an OOM/exit race) while keeping the process alive long
    // enough for the parent to observe EPIPE rather than only an exit event.
    lines.close();
    closeSync(0);
    setInterval(() => undefined, 1_000);
    send({
      type: 'result',
      id: request.id,
      ok: true,
      layout: {
        imagePath: request.imagePath,
        textDirection: request.textDirection,
        requestNumber,
        pid: process.pid,
      },
    });
    return;
  }
  if (request.imagePath === 'fail') {
    send({
      type: 'result',
      id: request.id,
      ok: false,
      error: {
        type: 'FixtureError',
        message: 'deliberate request failure',
      },
    });
    return;
  }
  send({
    type: 'result',
    id: request.id,
    ok: true,
    layout: {
      imagePath: request.imagePath,
      textDirection: request.textDirection,
      requestNumber,
      pid: process.pid,
    },
  });
});
