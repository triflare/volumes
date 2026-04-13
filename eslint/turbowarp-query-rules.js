import { createQueryRule } from './query-rule.js';

const turboWarpQueryRules = {
  'no-new-syntax': createQueryRule([
    {
      selector: 'AssignmentExpression[operator="??="]',
      message: 'x ??= y syntax is too new; use x = x ?? y instead',
    },
    {
      selector: 'MemberExpression[object.name=Object][property.name=hasOwn]',
      message:
        'Object.hasOwn(...) is too new; use Object.prototype.hasOwnProperty.call(...) instead',
    },
  ]),
  'no-xmlhttprequest': createQueryRule([
    {
      selector: 'NewExpression[callee.name=XMLHttpRequest]',
      message: 'Use Scratch.fetch() instead of XMLHttpRequest',
    },
  ]),
  'use-scratch-vm': createQueryRule([
    {
      selector: 'MemberExpression[object.name=window][property.name=vm]',
      message: 'Use Scratch.vm instead of window.vm',
    },
  ]),
  'use-scratch-fetch': createQueryRule([
    {
      selector: 'CallExpression[callee.name=fetch]',
      message: 'Use Scratch.fetch() instead of fetch()',
    },
    {
      selector: 'CallExpression[callee.object.name=window][callee.property.name=fetch]',
      message: 'Use Scratch.fetch() instead of window.fetch()',
    },
  ]),
  'use-scratch-open-window': createQueryRule([
    {
      selector: 'CallExpression[callee.name=open]',
      message: 'Use Scratch.openWindow() instead of open()',
    },
    {
      selector: 'CallExpression[callee.object.name=window][callee.property.name=open]',
      message: 'Use Scratch.openWindow() instead of window.open()',
    },
  ]),
  'use-scratch-redirect': createQueryRule([
    {
      selector: 'AssignmentExpression[left.object.name=location][left.property.name=href]',
      message: 'Use Scratch.redirect() instead of location.href = ...',
    },
    {
      selector:
        'AssignmentExpression[left.object.object.name=window][left.object.property.name=location][left.property.name=href]',
      message: 'Use Scratch.redirect() instead of window.location.href = ...',
    },
    {
      selector: 'AssignmentExpression[left.name=location]',
      message: 'Use Scratch.redirect() instead of location = ...',
    },
    {
      selector: 'AssignmentExpression[left.object.name=window][left.property.name=location]',
      message: 'Use Scratch.redirect() instead of window.location = ...',
    },
    {
      selector: 'CallExpression[callee.object.name=location][callee.property.name=assign]',
      message: 'Use Scratch.redirect() instead of location.assign()',
    },
    {
      selector:
        'CallExpression[callee.object.object.name=window][callee.object.property.name=location][callee.property.name=assign]',
      message: 'Use Scratch.redirect() instead of window.location.assign()',
    },
    {
      selector: 'CallExpression[callee.object.name=location][callee.property.name=replace]',
      message: 'Use Scratch.redirect() instead of location.replace()',
    },
    {
      selector:
        'CallExpression[callee.object.object.name=window][callee.object.property.name=location][callee.property.name=replace]',
      message: 'Use Scratch.redirect() instead of window.location.replace()',
    },
  ]),
  'check-can-fetch': createQueryRule([
    {
      selector: 'NewExpression[callee.name=WebSocket]',
      message:
        'Ensure that await Scratch.canFetch(url) is checked first, then add eslint-disable-next-line turbowarp/check-can-fetch',
    },
    {
      selector: 'NewExpression[callee.name=Image]',
      message:
        'Ensure that await Scratch.canFetch(url) is checked first, then add eslint-disable-next-line turbowarp/check-can-fetch',
    },
    {
      selector: 'NewExpression[callee.name=Audio]',
      message:
        'Ensure that await Scratch.canFetch(url) is checked first, then add eslint-disable-next-line turbowarp/check-can-fetch',
    },
  ]),
  'no-translate-setup': createQueryRule([
    {
      selector:
        'CallExpression[callee.object.object.name=Scratch][callee.object.property.name=translate][callee.property.name=setup]',
      message:
        'Do not call Scratch.translate.setup() yourself. Use Scratch.translate() and let the build script handle it.',
    },
  ]),
  'no-translate-alias': createQueryRule([
    {
      selector:
        'VariableDeclarator[init.type=MemberExpression][init.object.name=Scratch][init.property.name=translate]',
      message:
        'Do not store Scratch.translate in a variable, so build-time translation analysis remains accurate.',
    },
    {
      selector:
        'AssignmentExpression[right.type=MemberExpression][right.object.name=Scratch][right.property.name=translate]',
      message:
        'Do not store Scratch.translate in a variable, so build-time translation analysis remains accurate.',
    },
  ]),
  'should-not-translate': createQueryRule([
    {
      selector:
        'MethodDefinition[key.name=getInfo] Property[key.name=id][value.callee.property.name=translate]',
      message: 'Do not translate extension IDs.',
    },
    {
      selector:
        'MethodDefinition[key.name=getInfo] Property[key.name=opcode][value.callee.property.name=translate]',
      message: 'Do not translate block opcodes.',
    },
  ]),
};

export default turboWarpQueryRules;
