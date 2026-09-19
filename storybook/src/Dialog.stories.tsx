import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "../../app/src/components/ui/button";
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "../../app/src/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "../../app/src/components/ui/field";
import { Input } from "../../app/src/components/ui/input";

const meta = {
    title: "Components/Dialog",
    parameters: {
        docs: {
            description: {
                component:
                    "A Base UI dialog with focus management, an accessible title, and composable form actions.",
            },
        },
    },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const Form: Story = {
    render: () => (
        <Dialog>
            <DialogTrigger render={<Button variant="outline" />}>
                価格を訂正
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>価格を訂正</DialogTitle>
                    <DialogDescription>
                        記録日時を変えずに価格情報を修正します。
                    </DialogDescription>
                </DialogHeader>
                <FieldGroup>
                    <Field>
                        <FieldLabel htmlFor="story-price">価格（円）</FieldLabel>
                        <Input defaultValue="398" id="story-price" inputMode="numeric" />
                    </Field>
                </FieldGroup>
                <DialogFooter>
                    <DialogClose render={<Button type="button" variant="outline" />}>
                        キャンセル
                    </DialogClose>
                    <Button type="button">変更を保存</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    ),
};
