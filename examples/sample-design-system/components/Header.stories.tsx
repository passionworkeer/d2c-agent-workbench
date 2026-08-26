import type { Meta, StoryObj } from "@storybook/react";
import { Header } from "./Header";

const meta = {
  title: "SDS/Header",
  component: Header,
  argTypes: {
    theme: { control: "radio", options: ["light", "dark"] },
    brand: { control: "text" },
  },
} satisfies Meta<typeof Header>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Light: Story = { args: { theme: "light", links: [{ label: "新品", href: "/new" }] } };
export const Dark: Story = { args: { theme: "dark", links: [{ label: "新品", href: "/new" }] } };
