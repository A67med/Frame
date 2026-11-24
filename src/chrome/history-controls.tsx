import { ArrowLeft, ArrowRight } from "lucide-react";
import { useT } from "@/lib/i18n";
import { useView } from "@/app/navigation/view";

export function HistoryControls() {
  const { canGoBack, canGoForward, goBack, goForward } = useView();
  const t = useT();
  return (
    <div className="frame-history">
      <button
        type="button"
        disabled={!canGoBack}
        onClick={goBack}
        aria-label={t("Back")}
        title={t("Back")}
      >
        <ArrowLeft size={17} className="dir-icon" />
      </button>
      <button
        type="button"
        disabled={!canGoForward}
        onClick={goForward}
        aria-label={t("Forward")}
        title={t("Forward")}
      >
        <ArrowRight size={17} className="dir-icon" />
      </button>
    </div>
  );
}
