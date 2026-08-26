import type { Meta, StoryObj } from "@storybook/react";
import { Badge } from "./Badge";

const meta = {
  title: "SDS/Badge",
  component: Badge,
  argTypes: {
    tone: { control: "select", options: ["coral", "lime", "cobalt", "charcoal"] },
  },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const New: Story = { args: { tone: "coral", children: "New" } };
export const Sale: Story = { args: { tone: "lime", children: "Sale" } };
