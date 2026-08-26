import type { Meta, StoryObj } from "@storybook/react";
import { Text } from "./Text";

const meta = {
  title: "SDS/Text",
  component: Text,
  argTypes: {
    size: { control: "radio", options: ["display", "label", "body"] },
  },
} satisfies Meta<typeof Text>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Display: Story = { args: { size: "display", children: "秋季新品上市" } };
export const Body: Story = { args: { size: "body", children: "全部商品均为手工制作。" } };
