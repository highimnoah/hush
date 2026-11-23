import { getCurrentWindow } from "@tauri-apps/api/window";

import styles from "../../styles/layout.module.css";

type ResizeDirection =
  | "East"
  | "North"
  | "NorthEast"
  | "NorthWest"
  | "South"
  | "SouthEast"
  | "SouthWest"
  | "West";

const HANDLES: { direction: ResizeDirection; className: string }[] = [
  { direction: "North", className: styles.resizeN },
  { direction: "South", className: styles.resizeS },
  { direction: "East", className: styles.resizeE },
  { direction: "West", className: styles.resizeW },
  { direction: "NorthEast", className: styles.resizeNE },
  { direction: "NorthWest", className: styles.resizeNW },
  { direction: "SouthEast", className: styles.resizeSE },
  { direction: "SouthWest", className: styles.resizeSW },
];

/**
 * Invisible edge handles for the borderless window. GTK/Windows do not draw
 * resize borders without decorations, so these restore edge resizing.
 */
export function WindowResizeHandles() {
  const appWindow = getCurrentWindow();

  return (
    <div className={styles.resizeHandles} aria-hidden="true">
      {HANDLES.map(({ direction, className }) => (
        <div
          key={direction}
          className={`${styles.resizeHandle} ${className}`}
          onMouseDown={(event) => {
            event.preventDefault();
            void appWindow.startResizeDragging(direction);
          }}
        />
      ))}
    </div>
  );
}
