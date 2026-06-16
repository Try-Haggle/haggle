import { redirect } from "next/navigation";

// NOTE: The marketing landing page is temporarily disabled. The root path now
// redirects to the sign-in page. To restore the landing page, remove the
// redirect below and re-enable the <Landing /> render in Home().
// import { Landing } from "./(marketing)/landing";

export default function Home() {
  redirect("/sign-in");

  // Previous landing page (commented out — restore by removing the redirect above):
  // return <Landing />;
}
