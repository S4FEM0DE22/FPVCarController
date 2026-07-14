import CameraVirtualJoystick from "@/components/controller/CameraVirtualJoystick";
import type { ActionCommand } from "@/types/control";

interface CameraJoystickProps {
  onAction: (action: ActionCommand, payload?: Record<string, unknown>) => void;
  size?: number;
}

export default function CameraJoystick({ onAction, size = 124 }: CameraJoystickProps) {
  return (
    <div className="camera-joystick pointer-events-auto">
      <CameraVirtualJoystick onAction={onAction} size={size} compact />
    </div>
  );
}
