import { Search, X } from "lucide-react";

import styles from "../../styles/library.module.css";

interface ViewSearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
}

/** Search input used by the library views (Artists, Albums, Songs, Playlists). */
export function ViewSearchBar({
  value,
  onChange,
  placeholder = "Search",
  ariaLabel,
}: ViewSearchBarProps) {
  return (
    <div className={styles.searchWrap}>
      <Search size={17} className={styles.searchIcon} />
      <input
        className={styles.searchInput}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        spellCheck={false}
        autoComplete="off"
      />
      {value ? (
        <button
          type="button"
          className={styles.searchClear}
          onClick={() => onChange("")}
          aria-label="Clear search"
        >
          <X size={15} />
        </button>
      ) : null}
    </div>
  );
}
