import type { Meta, StoryObj } from "@storybook/react";
import { ProductCard } from "./ProductCard";

const meta = {
  title: "SDS/ProductCard",
  component: ProductCard,
  argTypes: {
    tone: { control: "select", options: ["coral", "lime", "cobalt", "charcoal"] },
    badge: { control: "text" },
    title: { control: "text" },
  },
} satisfies Meta<typeof ProductCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { tone: "coral", badge: "New", title: "手工陶瓷杯" } };
export const Lime: Story = { args: { tone: "lime", title: "黄铜台灯" } };
