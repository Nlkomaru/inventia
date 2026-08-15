type PagePlaceholderProps = {
    description: string;
    title: string;
};

export function PagePlaceholder({ description, title }: PagePlaceholderProps) {
    return (
        <section className="flex flex-1 flex-col gap-2 p-4">
            <h1 className="text-2xl font-semibold">{title}</h1>
            <p className="text-muted-foreground">{description}</p>
        </section>
    );
}
