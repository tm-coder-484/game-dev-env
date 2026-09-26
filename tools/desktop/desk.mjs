#!/usr/bin/env node
// CLI for the virtual desktop ("computer use" for native apps). Each command
// is one action, so it's easy to script or for an AI agent to call step by step.
//
//   node tools/desktop/desk.mjs start [WxH]                  virtual display (default 1280x720)
//   node tools/desktop/desk.mjs launch "<command>" [--wait <title regex>]
//   node tools/desktop/desk.mjs shot [out.png] [--window <regex>]
//   node tools/desktop/desk.mjs click X Y [--right|--middle] [--double]
//   node tools/desktop/desk.mjs move X Y  |  look DX DY  |  drag X1 Y1 X2 Y2  |  scroll N [X Y]
//   node tools/desktop/desk.mjs type "text"
//   node tools/desktop/desk.mjs key "ctrl+s Return"  |  key "w shift" --hold 2
//   node tools/desktop/desk.mjs windows | focus <regex> | apps | logs <pid> | kill <pid|all>
//   node tools/desktop/desk.mjs record [seconds] [out.mp4]
//   node tools/desktop/desk.mjs wait <seconds> | stop
import * as d from './lib.mjs';

const argv = process.argv.slice(2);
const flags = {};
const pos = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    const next = argv[i + 1];
    flags[a.slice(2)] = next === undefined || next.startsWith('--') || /^(right|middle|double)$/.test(a.slice(2)) ? true : (i++, next);
  } else pos.push(a);
}
const [cmd, ...args] = pos;
const num = (v) => (v === undefined ? undefined : Number(v));
const out = (v) => console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 2));

try {
  switch (cmd) {
    case 'start': {
      const [w, h] = (args[0] ?? '1280x720').split('x').map(Number);
      out(await d.start({ width: w, height: h }));
      break;
    }
    case 'stop': out(d.stop()); break;
    case 'launch': out(await d.launch(args.join(' '), { waitFor: flags.wait, timeout: num(flags.timeout) ?? 60 })); break;
    case 'shot': {
      const r = await d.screenshot({ window: flags.window, out: args[0] });
      out(`${r.path} (${r.width}x${r.height})`);
      break;
    }
    case 'click':
      out(d.click(num(args[0]), num(args[1]), { button: flags.right ? 'right' : flags.middle ? 'middle' : 'left', double: !!flags.double }));
      break;
    case 'move': out(d.move(num(args[0]), num(args[1]))); break;
    case 'look': out(await d.moveRelative(num(args[0]), num(args[1]))); break;
    case 'drag': out(await d.drag(...args.slice(0, 4).map(Number))); break;
    case 'scroll': out(d.scroll(num(args[0]), num(args[1]), num(args[2]))); break;
    case 'type': out(d.type(args.join(' '))); break;
    case 'key': out(await d.key(args.join(' '), { hold: num(flags.hold) })); break;
    case 'windows': out(d.windows()); break;
    case 'focus': out(d.focus(args[0])); break;
    case 'apps': out(d.apps()); break;
    case 'logs': out(d.logs(Number(args[0]), num(flags.lines) ?? 40)); break;
    case 'kill':
      if (args[0] === 'all') for (const a of d.apps()) d.killApp(a.pid);
      else d.killApp(Number(args[0]));
      out('ok');
      break;
    case 'record': out(d.record({ seconds: num(args[0]) ?? 5, out: args[1] })); break;
    case 'wait': await d.sleep(num(args[0]) ?? 1); break;
    default:
      console.log(
        'usage: desk.mjs <start|launch|shot|click|move|look|drag|scroll|type|key|windows|focus|apps|logs|kill|record|wait|stop> ...\n' +
          'see the header of tools/desktop/desk.mjs for details',
      );
      process.exit(cmd ? 1 : 0);
  }
} catch (err) {
  console.error(String(err.message ?? err));
  process.exit(1);
}
