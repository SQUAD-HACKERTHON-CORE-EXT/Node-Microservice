text = input("enter a string:")

compact_text= text.replace(" ","")

if compact_text.isalpha():
    print("text only contains alphabet characters")
else:
    print("text contains non-alphabetic character")