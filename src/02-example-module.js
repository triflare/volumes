export function sayHelloImpl(args) {
  return `Hello, ${args.NAME}!`;
}

export function colorBlock(args) {
  const color = args.COLOR || '#FF0000';
  return `Selected color: ${color}`;
}

export function calculateDistance(args) {
  const x1 = Number(args.X1) || 0;
  const y1 = Number(args.Y1) || 0;
  const x2 = Number(args.X2) || 0;
  const y2 = Number(args.Y2) || 0;

  const dx = x2 - x1;
  const dy = y2 - y1;
  return Math.sqrt(dx * dx + dy * dy);
}
