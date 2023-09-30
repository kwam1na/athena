interface ColorPickerProps {
   field: {
      name: string;
      value: any;
   };
   disabled: boolean;
}

export const ColorPicker: React.FC<ColorPickerProps> = ({
   field,
   disabled,
}) => {
   return (
      <input
         //  className="rounded-full"
         type="color"
         disabled={disabled}
         {...field}
      />
   );
};
