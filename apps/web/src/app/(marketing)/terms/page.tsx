export const metadata = {
  title: "Terms of Service | Haggle",
  description: "Haggle Terms of Service",
};

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 py-16">
      <h1 className="text-3xl font-bold text-white mb-2">Terms of Service</h1>
      <p className="text-sm text-slate-500 mb-10">Effective Date: April 13, 2026</p>

      <div className="prose prose-invert prose-slate max-w-none space-y-8 text-slate-300 leading-relaxed">

        <section>
          <h2 className="text-xl font-semibold text-white mb-3">1. Agreement to Terms</h2>
          <p>
            These Terms of Service (&ldquo;Terms&rdquo;) govern your access to and use of the Haggle
            platform (&ldquo;Service&rdquo;), operated by Haggle LLC, a Delaware limited liability company
            (&ldquo;Haggle,&rdquo; &ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;) at{" "}
            <a href="https://tryhaggle.ai" className="text-cyan-400 hover:text-cyan-300">
              tryhaggle.ai
            </a>
            . By accessing or using the Service, you agree to be bound by these Terms. If you do not
            agree, you may not use the Service.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-white mb-3">2. Description of Service</h2>
          <p>
            Haggle is an AI-powered peer-to-peer negotiation and payment protocol. The Service enables
            users to list items for sale, conduct AI-assisted price negotiations, and settle transactions
            using USDC stablecoins on the Base blockchain network. Haggle acts solely as a protocol
            facilitator and does not take custody of user funds at any time.
          </p>
          <p className="mt-3">
            Haggle is not a marketplace, broker, auctioneer, or financial institution. All transactions
            are conducted directly between buyers and sellers via smart contracts. Haggle does not
            guarantee the quality, safety, legality, or availability of any listed item.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-white mb-3">3. Eligibility</h2>
          <p>
            You must be at least 18 years of age and have the legal capacity to enter into contracts in
            your jurisdiction to use the Service. By using the Service, you represent and warrant that
            you meet these requirements. You may not use the Service if you are located in a jurisdiction
            where cryptocurrency transactions or peer-to-peer commerce is prohibited.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-white mb-3">4. User Accounts and Obligations</h2>
          <p>You agree to:</p>
          <ul className="list-disc list-inside space-y-2 mt-3 ml-2">
            <li>Provide accurate and complete information when registering or listing items.</li>
            <li>Maintain the security of your account credentials and connected wallet.</li>
            <li>List only items you own or have legal authority to sell.</li>
            <li>Accurately describe the condition, provenance, and specifications of listed items.</li>
            <li>Complete transactions in good faith once a negotiated price has been accepted.</li>
            <li>Comply with all applicable laws, including laws regarding the sale of goods, consumer protection, and anti-money laundering.</li>
            <li>Not use the Service to sell counterfeit, stolen, illegal, or prohibited items.</li>
            <li>Not attempt to manipulate, circumvent, or abuse the AI negotiation system.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-white mb-3">5. AI Negotiation Agents</h2>
          <p>
            The Service uses AI agents to facilitate price negotiation on behalf of buyers and sellers.
            You acknowledge and agree that:
          </p>
          <ul className="list-disc list-inside space-y-2 mt-3 ml-2">
            <li>
              AI agents act as automated representatives based on parameters you set. They do not
              constitute legal advice or financial advice.
            </li>
            <li>
              Haggle makes no warranty that AI-generated offers, counteroffers, or recommendations
              are optimal, accurate, or suitable for your specific circumstances.
            </li>
            <li>
              You retain full responsibility for reviewing and accepting or rejecting any negotiated
              outcome before a transaction is finalized.
            </li>
            <li>
              AI outputs may contain errors and should not be relied upon as the sole basis for
              high-value financial decisions.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-white mb-3">6. Payment Terms and Cryptocurrency</h2>
          <p>
            All transactions on the Service are settled in USDC on the Base network via non-custodial
            smart contracts. You acknowledge and agree that:
          </p>
          <ul className="list-disc list-inside space-y-2 mt-3 ml-2">
            <li>
              Haggle is non-custodial. We do not hold, store, or control your crypto assets at any
              time. You are solely responsible for the security of your connected wallet.
            </li>
            <li>
              Blockchain transactions are irreversible once confirmed. Haggle cannot reverse, refund,
              or recover funds lost due to user error, lost private keys, or incorrect wallet addresses.
            </li>
            <li>
              Cryptocurrency values may fluctuate. USDC is a stablecoin, but Haggle makes no
              representation regarding its value, stability, or regulatory treatment.
            </li>
            <li>
              You are solely responsible for any tax obligations arising from your use of the Service,
              including capital gains or income taxes related to cryptocurrency transactions.
            </li>
            <li>
              Haggle charges a platform fee of 1.5% of the final transaction value, deducted via smart
              contract at settlement. Additional gas fees are paid by users and are not controlled by Haggle.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-white mb-3">7. Shipping and Item Condition</h2>
          <p>
            Sellers are responsible for shipping items as described and in the condition agreed upon.
            Buyers agree to inspect items upon receipt and report discrepancies through the Service&apos;s
            dispute process within the applicable review period. Haggle is not responsible for items
            lost, damaged, or delayed in transit.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-white mb-3">8. Dispute Resolution</h2>
          <p>
            The Service includes an automated dispute resolution system for qualifying transactions.
            Users agree to:
          </p>
          <ul className="list-disc list-inside space-y-2 mt-3 ml-2">
            <li>
              Attempt good-faith resolution through the platform&apos;s dispute tools before seeking
              external remedies.
            </li>
            <li>
              Accept that dispute panel decisions made through the Service are final with respect to
              smart contract fund release, subject to applicable law.
            </li>
            <li>
              Provide accurate evidence and documentation when submitting or responding to disputes.
            </li>
          </ul>
          <p className="mt-3">
            For disputes not resolvable through the platform, you agree that any legal claim arising
            from these Terms or the Service shall be governed by the laws of the State of Delaware,
            without regard to conflict of law provisions, and shall be resolved through binding
            arbitration under the American Arbitration Association Commercial Arbitration Rules.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-white mb-3">9. Intellectual Property</h2>
          <p>
            The Service, including its software, algorithms, UI, and brand elements, is owned by
            Haggle LLC and protected by applicable intellectual property laws. You may not copy,
            reverse-engineer, or create derivative works from the Service without prior written consent.
          </p>
          <p className="mt-3">
            The Haggle Negotiation Protocol (HNP) specification is published openly. Nothing in these
            Terms restricts your use of the published specification for building compatible implementations.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-white mb-3">10. Limitation of Liability</h2>
          <p>
            TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, HAGGLE LLC, ITS OFFICERS, DIRECTORS,
            EMPLOYEES, AND AGENTS SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL,
            CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING LOSS OF PROFITS, DATA, OR GOODWILL, ARISING
            FROM YOUR USE OF THE SERVICE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.
          </p>
          <p className="mt-3">
            HAGGLE&apos;S TOTAL LIABILITY FOR ANY CLAIM ARISING FROM OR RELATED TO THESE TERMS OR THE
            SERVICE SHALL NOT EXCEED THE GREATER OF (A) THE TOTAL PLATFORM FEES PAID BY YOU IN THE
            THREE MONTHS PRECEDING THE CLAIM, OR (B) ONE HUNDRED DOLLARS (USD $100).
          </p>
          <p className="mt-3">
            THE SERVICE IS PROVIDED &ldquo;AS IS&rdquo; AND &ldquo;AS AVAILABLE&rdquo; WITHOUT WARRANTIES OF ANY KIND,
            EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO WARRANTIES OF MERCHANTABILITY, FITNESS
            FOR A PARTICULAR PURPOSE, OR NON-INFRINGEMENT.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-white mb-3">11. Indemnification</h2>
          <p>
            You agree to indemnify and hold harmless Haggle LLC and its affiliates from and against
            any claims, liabilities, damages, losses, and expenses (including reasonable legal fees)
            arising from your use of the Service, your violation of these Terms, or your violation of
            any rights of a third party.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-white mb-3">12. Prohibited Uses</h2>
          <p>You may not use the Service to:</p>
          <ul className="list-disc list-inside space-y-2 mt-3 ml-2">
            <li>Facilitate money laundering, fraud, or other illegal financial activities.</li>
            <li>Sell items that are illegal, counterfeit, stolen, or subject to export controls.</li>
            <li>Violate any applicable law or regulation.</li>
            <li>Harass, threaten, or defraud other users.</li>
            <li>Attempt to gain unauthorized access to other accounts or system infrastructure.</li>
            <li>Systematically scrape, harvest, or extract data from the Service.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-white mb-3">13. Termination</h2>
          <p>
            Haggle may suspend or terminate your access to the Service at any time, with or without
            notice, for violation of these Terms or for any other reason at our discretion. Upon
            termination, your right to use the Service ceases immediately. Sections 6, 8, 9, 10, 11,
            and 14 survive termination.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-white mb-3">14. Changes to Terms</h2>
          <p>
            Haggle reserves the right to modify these Terms at any time. We will provide notice of
            material changes by updating the effective date above and, where practicable, by notifying
            you via email or in-app notice. Your continued use of the Service after changes become
            effective constitutes acceptance of the revised Terms.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-white mb-3">15. Contact</h2>
          <p>
            For questions about these Terms, contact us at:{" "}
            <a href="mailto:legal@tryhaggle.ai" className="text-cyan-400 hover:text-cyan-300">
              legal@tryhaggle.ai
            </a>
            <br />
            Haggle LLC, Delaware, United States
          </p>
        </section>
      </div>
    </div>
  );
}
