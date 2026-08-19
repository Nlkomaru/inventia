import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { DatePicker } from "@/components/ui/date-picker";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";

const meta = {
    title: "Components/DatePicker",
    component: DatePicker,
    parameters: {
        layout: "centered",
        docs: {
            description: {
                component:
                    "日付の入力。値は常に YYYY-MM-DD の文字列で、ブラウザ既定の日付欄と違って表示の書式が環境で変わらない。カレンダーは Popover の中に出る。",
            },
        },
    },
    args: {
        id: "story-date",
        value: "2020-01-01",
        onValueChange: () => undefined,
    },
} satisfies Meta<typeof DatePicker>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 入力済みの状態。値はそのまま表示され、カレンダーはその月を開く。 */
export const Default: Story = {};

export const Empty: Story = {
    args: {
        value: "",
    },
};

export const Disabled: Story = {
    args: {
        disabled: true,
    },
};

/** ラベルとエラーを結びつけた、フォームでの使い方。 */
export const WithFieldAndError: Story = {
    render: (args) => (
        <Field data-invalid>
            <FieldLabel htmlFor={args.id}>期限（日付）</FieldLabel>
            <DatePicker
                {...args}
                aria-describedby="story-date-error"
                aria-invalid
                value="2020-13-01"
            />
            <FieldError id="story-date-error">
                日付は 2020-01-01 の形式で入力してください
            </FieldError>
        </Field>
    ),
};

/** 実際に値が変わる例。カレンダーで選ぶと入力欄へ反映される。 */
export const Interactive: Story = {
    render: (args) => {
        const [value, setValue] = useState("");
        return (
            <Field>
                <FieldLabel htmlFor={args.id}>期限（日付）</FieldLabel>
                <DatePicker {...args} onValueChange={setValue} value={value} />
            </Field>
        );
    },
};
