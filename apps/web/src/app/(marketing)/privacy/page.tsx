export const metadata = {
  title: "Privacy Policy | Haggle",
  description: "Haggle Privacy Policy",
};

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 py-16">
      <h1 className="text-3xl font-bold text-white mb-2">Privacy Policy</h1>
      <p className="text-sm text-slate-500 mb-10">Effective Date: April 13, 2026</p>

      <div className="prose prose-invert prose-slate max-w-none space-y-8 text-slate-300 leading-relaxed">

        <section>
          <h2 className="text-xl font-semibold text-white mb-3">1. Overview</h2>
          <p>
            Haggle LLC (&ldquo;Haggle,&rdquo; &ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;), a Delaware limited liability company,
            operates{" "}
            <a href="https://tryhaggle.ai" className="text-cyan-400 hover:text-cyan-300">
              tryhaggle.ai
            </a>
            . This Privacy Policy explains how we collect, use, store, and share information about
            you when you use our Service. We are committed to handling your data with care and
            transparency.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-white mb-3">2. Information We Collect</h2>

          <h3 className="text-base font-semibold text-slate-200 mb-2">2.1 Information You Provide</h3>
          <ul className="list-disc list-inside space-y-2 ml-2">
            <li>
              <strong>Account information:</strong> Email address and any profile information you
              provide upon registration.
            </li>
            <li>
              <strong>Listing data:</strong> Item descriptions, photos, pricing parameters, and
              condition information you submit.
            </li>
            <li>
              <strong>Negotiation parameters:</strong> Your minimum/maximum price thresholds,
              strategy settings, and AI agent configuration.
            </li>
            <li>
              <strong>Communication:</strong> Messages or support requests you send to us.
            </li>
            <li>
              <strong>Dispute information:</strong> Evidence, descriptions, and communications
              submitted through the dispute resolution process.
            </li>
          </ul>

          <h3 className="text-base font-semibold text-slate-200 mt-4 mb-2">2.2 Automatically Collected Information</h3>
          <ul className="list-disc list-inside space-y-2 ml-2">
            <li>
              <strong>Usage data:</strong> Pages visited, features used, session duration, and
              interaction logs with AI agents.
            </li>
            <li>
              <strong>Device data:</strong> IP address, browser type, operating system, and
              referring URLs.
            </li>
            <li>
              <strong>Cookies and local storage:</strong> Session tokens and preference data (see
              Section 7).
            </li>
          </ul>

          <h3 className="text-base font-semibold text-slate-200 mt-4 mb-2">2.3 Blockchain and Wallet Data</h3>
          <p>
            When you connect a crypto wallet or initiate an on-chain transaction, we may collect
            your public wallet address. Wallet addresses are public by nature of the blockchain.
            We do not collect private keys, seed phrases, or any information that would grant us
            access to your wallet. Transaction data recorded on the Base blockchain is publicly
            visible and immutable; Haggle has no ability to alter or delete on-chain records.
          </p>

          <h3 className="text-base font-semibold text-slate-200 mt-4 mb-2">2.4 Negotiation and Transaction Data</h3>
          <p>
            We collect data about negotiation sessions, including offer/counteroffer sequences,
            final agreed prices, and outcome results. This data is used to operate the Service,
            improve AI models, and (in anonymized or aggregated form) to build our negotiation
            intelligence platform.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-white mb-3">3. How We Use Your Information</h2>
          <ul className="list-disc list-inside space-y-2 ml-2">
            <li>To operate, maintain, and improve the Service.</li>
            <li>To facilitate and record transactions between buyers and sellers.</li>
            <li>To train and improve AI negotiation models using anonymized negotiation data.</li>
            <li>To enforce our Terms of Service, detect fraud, and maintain platform integrity.</li>
            <li>To send transactional communications (e.g., offer notifications, dispute updates).</li>
            <li>To comply with legal obligations, including anti-money laundering requirements.</li>
            <li>To analyze usage trends and improve user experience.</li>
          </ul>
          <p className="mt-3">
            We do not sell your personal information to third parties. We do not use your data
            for advertising targeting on third-party platforms.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-white mb-3">4. How We Share Your Information</h2>

          <h3 className="text-base font-semibold text-slate-200 mb-2">4.1 With Other Users</h3>
          <p>
            Certain information is shared with transaction counterparties as necessary to complete
            a deal, including your username or display name and shipping address (shared only after
            a transaction is confirmed).
          </p>

          <h3 className="text-base font-semibold text-slate-200 mt-4 mb-2">4.2 Service Providers</h3>
          <p>We use the following categories of third-party service providers:</p>
          <ul className="list-disc list-inside space-y-2 ml-2 mt-2">
            <li>
              <strong>Authentication:</strong> Supabase (user authentication and database hosting).
            </li>
            <li>
              <strong>AI providers:</strong> OpenAI and similar providers for AI negotiation
              inference. Negotiation data sent to AI providers is subject to their data policies.
              We do not send personally identifiable information as part of negotiation prompts
              where avoidable.
            </li>
            <li>
              <strong>Shipping:</strong> EasyPost for shipping label generation and carrier
              integration. Shipping address data is shared with EasyPost as required.
            </li>
            <li>
              <strong>Blockchain infrastructure:</strong> Base network RPC providers for
              transaction submission and monitoring.
            </li>
            <li>
              <strong>Analytics:</strong> Anonymized, aggregated usage analytics may be processed
              by analytics platforms.
            </li>
          </ul>

          <h3 className="text-base font-semibold text-slate-200 mt-4 mb-2">4.3 Legal Requirements</h3>
          <p>
            We may disclose your information if required by law, court order, subpoena, or
            government regulation, or when we believe disclosure is necessary to protect the rights,
            property, or safety of Haggle, our users, or the public.
          </p>

          <h3 className="text-base font-semibold text-slate-200 mt-4 mb-2">4.4 Business Transfers</h3>
          <p>
            In the event of a merger, acquisition, or sale of assets, your information may be
            transferred as part of the transaction. We will notify you of any such change and the
            choices you have.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-white mb-3">5. Data Retention</h2>
          <p>
            We retain account and transaction data for as long as your account is active and for
            up to 7 years thereafter as required for tax, legal, and dispute resolution purposes.
            Negotiation session data used for AI training is retained in anonymized form
            indefinitely. You may request deletion of your personal data subject to legal retention
            requirements (see Section 6).
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-white mb-3">6. Your Rights</h2>
          <p>
            Depending on your jurisdiction, you may have the following rights regarding your
            personal information:
          </p>
          <ul className="list-disc list-inside space-y-2 ml-2 mt-3">
            <li>
              <strong>Access:</strong> Request a copy of the personal data we hold about you.
            </li>
            <li>
              <strong>Correction:</strong> Request correction of inaccurate personal data.
            </li>
            <li>
              <strong>Deletion:</strong> Request deletion of your personal data, subject to legal
              retention requirements.
            </li>
            <li>
              <strong>Portability:</strong> Request a machine-readable export of your data.
            </li>
            <li>
              <strong>Opt-out of sale (CCPA):</strong> California residents have the right to
              opt out of the sale of personal information. We do not sell personal information.
            </li>
            <li>
              <strong>GDPR rights:</strong> EEA residents have the right to object to processing,
              restrict processing, and lodge a complaint with a supervisory authority.
            </li>
          </ul>
          <p className="mt-3">
            To exercise your rights, contact us at{" "}
            <a href="mailto:privacy@tryhaggle.ai" className="text-cyan-400 hover:text-cyan-300">
              privacy@tryhaggle.ai
            </a>
            . We will respond within 30 days.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-white mb-3">7. Cookies and Tracking</h2>
          <p>We use the following types of cookies and similar technologies:</p>
          <ul className="list-disc list-inside space-y-2 ml-2 mt-3">
            <li>
              <strong>Essential cookies:</strong> Required for authentication and session management.
              These cannot be disabled without breaking core functionality.
            </li>
            <li>
              <strong>Preference cookies:</strong> Store your settings and preferences.
            </li>
            <li>
              <strong>Analytics cookies:</strong> Help us understand how users interact with the
              Service. These are anonymized where possible.
            </li>
          </ul>
          <p className="mt-3">
            We do not use advertising or cross-site tracking cookies. You can control cookies
            through your browser settings, though disabling essential cookies may impair functionality.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-white mb-3">8. Security</h2>
          <p>
            We implement industry-standard security practices including encryption in transit (TLS),
            encryption at rest, JWT-based authentication, and smart contract security audits.
            However, no system is completely secure. You are responsible for maintaining the
            security of your account credentials and connected wallet. We will never ask for your
            private keys or seed phrases.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-white mb-3">9. Children&apos;s Privacy</h2>
          <p>
            The Service is not directed to individuals under 18 years of age. We do not knowingly
            collect personal information from minors. If you believe a minor has provided us with
            personal information, contact us at{" "}
            <a href="mailto:privacy@tryhaggle.ai" className="text-cyan-400 hover:text-cyan-300">
              privacy@tryhaggle.ai
            </a>{" "}
            and we will delete it.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-white mb-3">10. International Transfers</h2>
          <p>
            Haggle is based in the United States. Your information may be processed in the United
            States and other countries where our service providers operate. By using the Service,
            you consent to the transfer of your information to countries that may have different
            data protection laws than your country of residence.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-white mb-3">11. Changes to This Policy</h2>
          <p>
            We may update this Privacy Policy from time to time. We will notify you of material
            changes by updating the effective date and, where practicable, by sending you an email
            notification. Your continued use of the Service after changes take effect constitutes
            your acceptance of the revised policy.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-white mb-3">12. Contact Us</h2>
          <p>
            For privacy-related questions or to exercise your rights:
          </p>
          <p className="mt-2">
            <a href="mailto:privacy@tryhaggle.ai" className="text-cyan-400 hover:text-cyan-300">
              privacy@tryhaggle.ai
            </a>
            <br />
            Haggle LLC, Delaware, United States
          </p>
        </section>
      </div>
    </div>
  );
}
