import { Topbar } from "@/components/sections/Topbar";
import { Hero } from "@/components/sections/Hero";
import { HowItWorks } from "@/components/sections/HowItWorks";
import { Comparison } from "@/components/sections/Comparison";
import { Faq } from "@/components/sections/Faq";
import { FinalCta } from "@/components/sections/FinalCta";
import { Footer } from "@/components/sections/Footer";

export default function Page() {
  return (
    <>
      <Topbar />
      <main>
        <Hero />
        <HowItWorks />
        <Comparison />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
    </>
  );
}
