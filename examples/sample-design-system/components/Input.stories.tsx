import type { Meta, StoryObj } from "@storybook/react";
import { Input } from "./Input";

const meta = {
  title: "SDS/Input",
  component: Input,
  argTypes: {
    state: { control: "radio", options: ["default", "error"] },
    label: { control: "text" },
    hint: { control: "text" },
    placeholder: { control: "text" },
  },
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { label: "邮箱", placeholder: "you@example.com" } };
export const Error: Story = { args: { label: "邮箱", state: "error", hint: "请输入合法邮箱地址" } };
