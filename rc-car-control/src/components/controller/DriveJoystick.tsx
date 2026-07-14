import VirtualJoystick from "@/components/controller/VirtualJoystick";
import type { ControlCommand } from "@/types/control";

interface DriveJoystickProps {
  onMove: (command: ControlCommand, payload?: Record<string, unknown>) => void;
  size?: number;
}

export default function DriveJoystick({ onMove, size = 124 }: DriveJoystickProps) {
  return (
    <div className="drive-joystick pointer-events-auto">
      <VirtualJoystick onMove={onMove} size={size} compact />
    </div>
  );
}
