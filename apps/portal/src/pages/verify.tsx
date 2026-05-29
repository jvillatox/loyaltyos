import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle, Loader2 } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";

import { verifyMagicLink } from "../lib/auth";

export default function Verify() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");

  const verifyMutation = useMutation({
    mutationFn: (tkn: string) => verifyMagicLink(tkn),
    onSuccess: () => {
      navigate("/", { replace: true });
    },
  });

  useEffect(() => {
    if (token) {
      verifyMutation.mutate(token);
    }
  }, [token]);

  if (!token) {
    return (
      <div className="mx-auto max-w-lg px-4 py-12 text-center">
        <AlertTriangle className="mx-auto h-12 w-12 text-amber-500" aria-hidden="true" />
        <p className="mt-4 text-lg font-medium">{t("verify.invalidLink")}</p>
        <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
          {t("verify.missingToken")}
        </p>
      </div>
    );
  }

  if (verifyMutation.isPending) {
    return (
      <div className="mx-auto max-w-lg px-4 py-12 text-center">
        <Loader2
          className="mx-auto h-12 w-12 animate-spin text-[var(--color-primary)]"
          aria-hidden="true"
        />
        <p className="mt-4 text-lg font-medium">{t("verify.signingIn")}</p>
      </div>
    );
  }

  if (verifyMutation.isError) {
    return (
      <div className="mx-auto max-w-lg px-4 py-12 text-center">
        <AlertTriangle className="mx-auto h-12 w-12 text-red-500" aria-hidden="true" />
        <p className="mt-4 text-lg font-medium">{t("verify.signInFailed")}</p>
        <p className="mt-2 text-sm text-[var(--color-text-secondary)]">{t("verify.expiredLink")}</p>
        <button
          onClick={() => {
            navigate("/profile", { replace: true });
          }}
          className="mt-6 rounded-lg bg-[var(--color-primary)] px-6 py-2.5 text-sm font-semibold text-white"
        >
          {t("verify.goToSignIn")}
        </button>
      </div>
    );
  }

  if (verifyMutation.isSuccess) {
    return (
      <div className="mx-auto max-w-lg px-4 py-12 text-center">
        <CheckCircle className="mx-auto h-12 w-12 text-green-500" aria-hidden="true" />
        <p className="mt-4 text-lg font-medium">{t("verify.signedIn")}</p>
        <p className="mt-2 text-sm text-[var(--color-text-secondary)]">{t("verify.redirecting")}</p>
      </div>
    );
  }

  return null;
}
