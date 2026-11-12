const stamp = () => new Date().toISOString().slice(11, 19);
export const log = (...args) => process.stderr.write(`[${stamp()}] ${args.join(' ')}\n`);
export const fail = (message) => {
  process.stderr.write(`\n✗ ${message}\n`);
  process.exitCode = 1;
  throw new Error(message);
};
