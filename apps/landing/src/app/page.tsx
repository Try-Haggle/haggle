import { Topbar } from "@/components/sections/Topbar";
import { Hero } from "@/components/sections/Hero";
import { HowItWorks } from "@/components/sections/HowItWorks";

export default function Page() {
  return (
    <>
      <Topbar />
      <main>
        <Hero />
        <HowItWorks />
      </main>
    </>
  );
}
