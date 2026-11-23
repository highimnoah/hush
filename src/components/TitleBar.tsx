import styles from "../styles/layout.module.css";
import { WindowControls } from "./ui/WindowControls";

/** Borderless window titlebar: brand, drag region, window controls. */
export function TitleBar() {
  return (
    <header className={styles.titleBar} data-tauri-drag-region>
      <div className={styles.titleBrand} data-tauri-drag-region>
        <div
          className={styles.titleBrandMark}
          aria-hidden="true"
          data-tauri-drag-region
        >
          <span />
          <span />
          <span />
        </div>
        <span className={styles.titleBrandName} data-tauri-drag-region>
          hush
        </span>
      </div>
      <div className={styles.titleDrag} data-tauri-drag-region />
      <WindowControls />
    </header>
  );
}
