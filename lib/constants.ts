export const defaultOptions: Record<string, any> = {
    method: 'GET',
    headers: {
        'Content-Type': 'application/json',
    },
};

export const currencies = [
    {
        label: 'US Dollar',
        value: 'usd'
    },
    {
        label: 'Ghanaian Cedi',
        value: 'ghs'
    },
]

export const mainContainerVariants = {
    hidden: {
        opacity: 0,
        y: 8,
    },
    visible: {
        opacity: 1,
        y: 0,
        transition: {
            type: 'easeIn',
            duration: 0.4,
        },
    },
};

export const widgetVariants = {
    hidden: {
        opacity: 0,
    },
    visible: {
        opacity: 1,
        transition: {
            type: 'easeIn',
            duration: 0.4,
        },
    },
}