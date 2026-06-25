import DefaultFormat from "@/components/settings/default-format";
import QualityPicker from "@/components/settings/quality";

export default function Settings() {
    return (
        <section className="section py-8 xl:py-10 2xl:py-12">
            <div className="mb-6 xl:mb-7 2xl:mb-8">
                <h2 className="text-2xl xl:text-3xl font-body font-semibold text-foreground">Settings</h2>
                <p className="text-sm xl:text-base text-muted-foreground mt-1">
                    Default quality and formats for new conversions.
                </p>
            </div>
            <div className="flex flex-col gap-y-6 xl:gap-y-7 2xl:gap-y-8">
                <QualityPicker />
                <DefaultFormat />
            </div>
        </section>
    )
}
