import type { Metadata } from "next";
import { LegalPage, LegalSection } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Privacy Policy | Playground",
  description: "Privacy Policy for Playground and its Google OAuth sign-in flow.",
};

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      summary="This policy explains what Playground collects when you use Google sign-in, how that information is used, and how to request deletion or support."
      updatedAt="March 14, 2026"
    >
      <LegalSection title="What Playground is">
        <p>
          Playground is a small collection of personal productivity tools,
          including Split Bill and SRE Machine Delivery. Google OAuth is used
          only to authenticate users who sign in to the app.
        </p>
      </LegalSection>

      <LegalSection title="What information we collect">
        <p>
          If you sign in with Google, Playground may receive your basic Google
          account profile information, such as your name, email address, and
          profile image.
        </p>
        <p>
          Playground tools may also store the content you create while using the
          app, such as split-bill entries or machine-tracking records. In the
          current version of the app, much of that tool data is stored locally in
          your browser on your device.
        </p>
      </LegalSection>

      <LegalSection title="How we use your information">
        <p>
          We use Google account information only to sign you in, keep your
          session active, and determine whether your account is allowed to access
          protected features.
        </p>
        <p>
          We use the data you enter into the tools only to provide the requested
          functionality, such as tracking subscription costs or machine delivery
          status.
        </p>
      </LegalSection>

      <LegalSection title="What we do not do">
        <p>
          Playground does not sell your personal information. Playground does not
          use your Google data for advertising. Playground does not request
          access to your Gmail, Google Drive, Google Calendar, or other Google
          services beyond basic sign-in identity information.
        </p>
      </LegalSection>

      <LegalSection title="Sharing and third parties">
        <p>
          Playground relies on service providers needed to run the app, such as
          hosting, authentication, and infrastructure providers. Your information
          is shared with those providers only as needed to operate the service.
        </p>
      </LegalSection>

      <LegalSection title="Data retention and deletion">
        <p>
          Authentication session data is retained only as long as needed to keep
          the sign-in experience working. Data stored locally in your browser can
          usually be removed by clearing site data from your browser.
        </p>
        <p>
          If you would like help deleting app-related information or have a
          privacy question, contact{" "}
          <a className="underline underline-offset-4" href="mailto:hi@noahyao.me">
            hi@noahyao.me
          </a>
          .
        </p>
      </LegalSection>

      <LegalSection title="Security">
        <p>
          Reasonable steps are taken to protect the app and its authentication
          flow, but no internet service can guarantee absolute security.
        </p>
      </LegalSection>

      <LegalSection title="Changes to this policy">
        <p>
          This Privacy Policy may be updated from time to time as the app
          evolves. Material changes will be reflected on this page with a new
          update date.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
