import type { Metadata } from "next";
import { LegalPage, LegalSection } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Terms of Service | Playground",
  description:
    "Terms of Service for using Playground and its Google OAuth sign-in flow.",
};

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      summary="These terms describe the basic rules for using Playground, including sign-in, acceptable use, and service limitations."
      updatedAt="March 14, 2026"
    >
      <LegalSection title="Acceptance of terms">
        <p>
          By accessing or using Playground, you agree to these Terms of Service.
          If you do not agree, please do not use the app.
        </p>
      </LegalSection>

      <LegalSection title="Use of the service">
        <p>
          Playground is provided as a lightweight set of tools for personal or
          internal use. You agree to use the service lawfully and not to misuse,
          disrupt, probe, or attempt unauthorized access to the app or related
          systems.
        </p>
      </LegalSection>

      <LegalSection title="Accounts and access">
        <p>
          Some features may require sign-in with Google. Access may be limited to
          approved accounts. You are responsible for the activity that occurs
          through your account and for keeping your Google account secure.
        </p>
      </LegalSection>

      <LegalSection title="Your content">
        <p>
          You are responsible for the data you enter into Playground. Please do
          not submit unlawful content, malicious content, or information you do
          not have permission to use.
        </p>
      </LegalSection>

      <LegalSection title="No warranty">
        <p>
          Playground is provided on an &quot;as is&quot; and &quot;as available&quot;
          basis without warranties of any kind. Features, calculations, and
          exchange-rate based outputs are offered for convenience and should be
          independently verified when accuracy matters.
        </p>
      </LegalSection>

      <LegalSection title="Limitation of liability">
        <p>
          To the maximum extent allowed by law, Playground and its operator will
          not be liable for indirect, incidental, special, consequential, or
          exemplary damages arising from your use of the service.
        </p>
      </LegalSection>

      <LegalSection title="Changes and availability">
        <p>
          Playground may change, suspend, or remove features at any time. These
          terms may also be updated from time to time, and continued use of the
          service after updates means you accept the revised terms.
        </p>
      </LegalSection>

      <LegalSection title="Contact">
        <p>
          Questions about these terms can be sent to{" "}
          <a className="underline underline-offset-4" href="mailto:hi@noahyao.me">
            hi@noahyao.me
          </a>
          .
        </p>
      </LegalSection>
    </LegalPage>
  );
}
