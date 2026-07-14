export const CONTROL_SOURCE = {
  keyboard: "keyboard",
  gamepad: "gamepad",
  touch: "touch",
  system: "system",
} as const;

export type ControlSource = (typeof CONTROL_SOURCE)[keyof typeof CONTROL_SOURCE];
