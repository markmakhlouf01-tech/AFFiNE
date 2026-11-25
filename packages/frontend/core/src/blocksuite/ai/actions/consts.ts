export const EXCLUDING_COPY_ACTIONS = [
  'brainstormMindmap',
  'expandMindmap',
  'makeItReal',
  'createSlides',
  'createImage',
  'createMuapiImage',
  'createMuapiVideo',
  'findActions',
  'filterImage',
  'processImage',
];

export const EXCLUDING_REPLACE_ACTIONS = [
  'brainstormMindmap',
  'expandMindmap',
  'makeItReal',
  'createSlides',
  'createImage',
  'createMuapiImage',
  'createMuapiVideo',
  'filterImage',
  'processImage',
];

export const EXCLUDING_INSERT_ACTIONS = ['generateCaption'];

export const IMAGE_ACTIONS = [
  'createImage',
  'createMuapiImage',
  'processImage',
  'filterImage',
];

export const VIDEO_ACTIONS = ['createMuapiVideo'];

const commonImageStages = ['Generating image', 'Rendering image'];

export const generatingStages: {
  [key in keyof Partial<BlockSuitePresets.AIActions>]: string[];
} = {
  makeItReal: ['Coding for you', 'Rendering the code'],
  brainstormMindmap: ['Thinking about this topic', 'Rendering mindmap'],
  createSlides: ['Thinking about this topic', 'Rendering slides'],
  createImage: commonImageStages,
  createMuapiImage: commonImageStages,
  createMuapiVideo: ['Generating video', 'Rendering video'],
  processImage: commonImageStages,
  filterImage: commonImageStages,
};

export const INSERT_ABOVE_ACTIONS = ['createHeadings'];
