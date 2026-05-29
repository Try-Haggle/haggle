import type { ReactNode } from "react";

export interface FaqItem {
  question: string;
  answer: ReactNode;
}

export const FAQ_ITEMS: FaqItem[] = [
  {
    question: "What is Haggle and how is it different from other marketplaces?",
    answer: (
      <>
        <p>
          Haggle is a marketplace where AI agents negotiate for you. Sellers
          build an agent for each listing. Buyers build their own. The two
          agents talk, settle on a fair price, and the deal is done.
        </p>
        <p>
          Most marketplaces still run on chat. Days of &quot;is this still
          available?&quot; and &quot;lowest price?&quot; DMs, half of them
          ignored. Haggle skips all of that.
        </p>
      </>
    ),
  },
  {
    question: "Can I still chat with the seller directly?",
    answer: (
      <p>
        By default, no. Your agent does all the talking. But if you ever want
        to step in, you can take over the negotiation yourself. The agent is
        there to save you time, not lock you out.
      </p>
    ),
  },
  {
    question: "What if my agent agrees to a price I don't want?",
    answer: (
      <p>
        It can&apos;t. When you build your agent, you set the floor (if
        you&apos;re selling) or the ceiling (if you&apos;re buying), and it
        never crosses that line. You stay in control. Your agent just does the
        boring part.
      </p>
    ),
  },
  {
    question: "Where does my money go during the transaction?",
    answer: (
      <p>
        Into a smart contract, not into our pocket. We never touch your funds.
        The contract releases payment to the seller only after the item is
        delivered and confirmed. If something goes wrong, the money goes back
        to you automatically.
      </p>
    ),
  },
  {
    question: "What does Haggle cost?",
    answer: (
      <>
        <p>
          1.5% per transaction. Most marketplaces take anywhere from 10% to
          20%.
        </p>
        <p>
          And here&apos;s the fun part. Even the fee split is negotiable. Want
          the buyer to pick up more of it? Your agent can negotiate that too.
        </p>
      </>
    ),
  },
];
