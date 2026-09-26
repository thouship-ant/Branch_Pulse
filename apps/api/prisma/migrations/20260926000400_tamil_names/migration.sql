-- Tamil display names (HLD s7: English + Tamil UI). Master data carries its own translation column;
-- the UI shows name_ta when the user's language is Tamil and falls back to the English name.
ALTER TABLE locations ADD COLUMN name_ta VARCHAR(100);

-- Backfill the seeded tea-shop masters on databases that already exist (fresh databases get these from the seed).
UPDATE locations SET name_ta = CASE code
  WHEN 'BR001' THEN 'அண்ணா நகர்'
  WHEN 'BR002' THEN 'தி. நகர்'
  WHEN 'BR003' THEN 'வேளச்சேரி'
  WHEN 'BR004' THEN 'அடையாறு'
  WHEN 'BR005' THEN 'தாம்பரம்'
  WHEN 'BR006' THEN 'போரூர்'
  WHEN 'GDN01' THEN 'மத்திய கிடங்கு'
  WHEN 'HO01'  THEN 'தலைமை அலுவலகம்'
END WHERE name_ta IS NULL AND code IN ('BR001','BR002','BR003','BR004','BR005','BR006','GDN01','HO01');

UPDATE expense_categories SET name_ta = CASE name_en
  WHEN 'Milk' THEN 'பால்'
  WHEN 'Tea powder' THEN 'தேயிலைத் தூள்'
  WHEN 'Coffee' THEN 'காபி'
  WHEN 'Sugar' THEN 'சர்க்கரை'
  WHEN 'Snacks / raw materials' THEN 'சிற்றுண்டி / மூலப்பொருட்கள்'
  WHEN 'Salary' THEN 'சம்பளம்'
  WHEN 'Staff advance' THEN 'ஊழியர் முன்பணம்'
  WHEN 'Rent' THEN 'வாடகை'
  WHEN 'Electricity' THEN 'மின்சாரம்'
  WHEN 'Gas' THEN 'எரிவாயு'
  WHEN 'Transport' THEN 'போக்குவரத்து'
  WHEN 'Maintenance' THEN 'பராமரிப்பு'
  WHEN 'Repairs' THEN 'பழுதுபார்ப்பு'
  WHEN 'Cleaning' THEN 'சுத்தம்'
  WHEN 'Cooking oil' THEN 'சமையல் எண்ணெய்'
  WHEN 'Packaging' THEN 'பேக்கிங்'
  WHEN 'Miscellaneous' THEN 'இதர'
END WHERE name_ta IS NULL AND parent_id IS NULL
  AND name_en IN ('Milk','Tea powder','Coffee','Sugar','Snacks / raw materials','Salary','Staff advance','Rent',
                  'Electricity','Gas','Transport','Maintenance','Repairs','Cleaning','Cooking oil','Packaging','Miscellaneous');

UPDATE inventory_items SET name_ta = CASE code
  WHEN 'ITM001' THEN 'பால்'
  WHEN 'ITM002' THEN 'தேயிலைத் தூள்'
  WHEN 'ITM003' THEN 'காபித் தூள்'
  WHEN 'ITM004' THEN 'சர்க்கரை'
  WHEN 'ITM005' THEN 'இஞ்சி'
  WHEN 'ITM006' THEN 'ஏலக்காய்'
  WHEN 'ITM007' THEN 'சமையல் எண்ணெய்'
  WHEN 'ITM008' THEN 'காகிதக் குவளை 150 மி.லி'
  WHEN 'ITM009' THEN 'கண்ணாடி டம்ளர்'
  WHEN 'ITM010' THEN 'தண்ணீர் பாட்டில் 1 லி'
END WHERE name_ta IS NULL AND code IN ('ITM001','ITM002','ITM003','ITM004','ITM005','ITM006','ITM007','ITM008','ITM009','ITM010');
