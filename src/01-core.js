import { colorBlock, sayHelloImpl } from './02-example-module.js';

class TurboWarpExtension {
  constructor() {
    this.runtime = null;
  }

  getInfo() {
    return {
      id: 'myTurboWarpExtension',
      name: Scratch.translate('My Extension'),
      color1: '#4CAF50',
      color2: '#45a049',
      color3: '#3d8b40',
      menuIconURI: mint.assets.get('icons/menu.png') ?? '',
      blockIconURI: mint.assets.get('icons/block.png') ?? '',
      blocks: [
        {
          opcode: 'helloWorld',
          blockType: 'reporter',
          text: Scratch.translate('hello world'),
        },
        {
          opcode: 'add',
          blockType: 'reporter',
          text: Scratch.translate('[A] + [B]'),
          arguments: {
            A: {
              type: 'number',
              defaultValue: 0,
            },
            B: {
              type: 'number',
              defaultValue: 1,
            },
          },
        },
        {
          opcode: 'colorBlock',
          blockType: 'reporter',
          text: Scratch.translate('selected color [COLOR]'),
          arguments: {
            COLOR: {
              type: 'color',
              defaultValue: '#FF0000',
            },
          },
        },
        {
          opcode: 'sayHello',
          blockType: 'reporter',
          text: Scratch.translate('say hello to [NAME]'),
          arguments: {
            NAME: {
              type: 'string',
              defaultValue: 'world',
            },
          },
        },
      ],
    };
  }

  sayHello(args) {
    return sayHelloImpl(args);
  }

  helloWorld() {
    return 'hello world!';
  }

  add(args) {
    return Number(args.A) + Number(args.B);
  }

  colorBlock(args) {
    return colorBlock(args);
  }
}

Scratch.extensions.register(new TurboWarpExtension());
