import type { Story } from "./types";
import { WizardShellDemo } from "./wizard-shell-demo";

export const wizardShellStory: Story = {
  slug: "wizard-shell",
  name: "WizardShell",
  componentName: "WizardShell",
  controls: {},
  render: () => (
    <div className="w-[40rem] max-w-full">
      <WizardShellDemo />
    </div>
  ),
};
