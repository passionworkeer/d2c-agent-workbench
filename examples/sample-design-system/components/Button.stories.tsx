import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "./Button";

const meta = {
  title: "SDS/Button",
  component: Button,
  argTypes: {
    variant: { control: "radio", options: ["primary", "secondary"] },
    size: { control: "radio", options: ["sm", "md"] },
    disabled: { control: "boolean" },
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = { args: { variant: "primary", children: "提交" } };
export const Secondary: Story = { args: { variant: "secondary", children: "取消" } };
