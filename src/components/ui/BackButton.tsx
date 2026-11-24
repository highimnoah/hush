import { ArrowLeft } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";

import styles from "../../styles/library.module.css";

interface BackButtonProps {
  /** Parent view used when there is no in-app history (e.g. "/albums"). */
  to: string;
  /** Parent name shown on the button (e.g. "Albums"). */
  label: string;
}

/**
 * History-aware back button for detail pages: in-app navigation goes back to
 * wherever the user came from, while deep links fall back to the parent view.
 */
export function BackButton({ to, label }: BackButtonProps) {
  const navigate = useNavigate();
  const location = useLocation();

  const goBack = () => {
    if (location.key !== "default") {
      navigate(-1);
    } else {
      navigate(to);
    }
  };

  return (
    <div className={styles.backRow}>
      <button
        type="button"
        className={styles.backBtn}
        onClick={goBack}
        aria-label={`Back to ${label}`}
      >
        <ArrowLeft size={15} />
        {label}
      </button>
    </div>
  );
}
