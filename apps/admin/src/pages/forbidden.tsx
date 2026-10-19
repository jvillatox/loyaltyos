import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

export function ForbiddenPage(): JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center">
        <h1 className="text-4xl font-bold">403</h1>
        <p className="mt-2 text-muted-foreground">{t("navigation.forbiddenDescription")}</p>
        <Link to="/" className="mt-4 inline-block text-primary underline">
          {t("navigation.backToDashboard")}
        </Link>
      </div>
    </div>
  );
}
